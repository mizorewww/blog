package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// ```echarts and ```mermaid fences are figures drawn as static SVG at build
// time by scripts/render-figures.py, in headless Chrome, and cached under
// .cache/figures, so a warm build starts neither Python nor Chrome. An
// ```echarts figure also carries its option as JSON: on the page, ECharts
// takes the figure over as it scrolls into view (templates/js/echart.js).
// A ```sketch is SVG drawn by hand and only checked (src/sketch.go).
type figureExtension struct{}

const (
	figureScript = "scripts/render-figures.py"
	figureTheme  = "templates/js/chart-theme.js"
	figureCache  = ".cache/figures"
	echartsFile  = "vendor/echarts-6.1.0.min.js" // under static/, published with the site
	figureWidth  = 704                           // the reading column
)

var (
	kindFigure       = ast.NewNodeKind("Figure")
	figureAttributes = []string{"title", "note", "height"}
	// figureTokens are the style.css colors a figure may name, as var(--name).
	// The build draws with a stand-in for each and the SVG keeps the variable.
	figureTokens = []string{"ink", "body", "muted", "faint", "line", "grid", "card", "paper", "wash", "clay", "clay-wash", "clay-ink", "stone", "sky", "olive", "kraft", "fig",
		"panel", "node", "node-line", "edge", "blue", "blue-wash", "blue-ink", "green", "green-wash", "green-ink", "orange", "orange-wash", "orange-ink", "violet", "violet-wash", "violet-ink"}
	figureToken  = regexp.MustCompile(`var\(--([\w-]+)\)`)
	fixedColor   = regexp.MustCompile(`(?i)^\s*(#[0-9a-f]{3,8}|rgba?\(|hsla?\()`)
	diagramPaint = regexp.MustCompile(`(fill|stroke|color|background)\s*:\s*([^,;\s]+)`)
	// colorKeywords are the non-color values ECharts takes where a color goes.
	colorKeywords = []string{"transparent", "none", "inherit", "auto", "gradient", "source", "target", "series", "data"}
	svgViewBox    = regexp.MustCompile(`^<svg[^>]*\sviewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"`)
)

type figureBlock struct {
	ast.BaseBlock
	Lang, Info string
	title      string
	note       string
	height     int
	source     string // the Mermaid text, or the compacted ECharts option
	SVG        string // set by the build's figure hook
}

func (n *figureBlock) Kind() ast.NodeKind            { return kindFigure }
func (n *figureBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }
func (n *figureBlock) IsRaw() bool                   { return true }

type figureTransformer struct{}
type figureRenderer struct{}

func (figureExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(figureTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(figureRenderer{}, 100)))
}

func (figureTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var fences []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fence, ok := n.(*ast.FencedCodeBlock); entering && ok {
			if lang := string(fence.Language(reader.Source())); lang == "echarts" || lang == "mermaid" || lang == "sketch" {
				fences = append(fences, fence)
			}
		}
		return ast.WalkContinue, nil
	})
	for _, fence := range fences {
		block := &figureBlock{Lang: string(fence.Language(reader.Source())), Info: string(fence.Info.Segment.Value(reader.Source()))}
		var src strings.Builder
		for i := 0; i < fence.Lines().Len(); i++ {
			line := fence.Lines().At(i)
			src.Write(line.Value(reader.Source()))
		}
		block.source = src.String()
		fence.Parent().ReplaceChild(fence.Parent(), fence, block)
	}
}

// parse checks the fence and its body; renderContent calls it on every figure.
func (n *figureBlock) parse() error {
	attrs, err := blockAttributes(n.Info, figureAttributes)
	if err != nil {
		return err
	}
	n.title, n.note = attrs["title"], attrs["note"]
	if strings.TrimSpace(n.title) == "" {
		return fmt.Errorf("needs a title")
	}
	if strings.TrimSpace(n.source) == "" {
		return fmt.Errorf("is empty")
	}
	if n.Lang != "echarts" {
		if _, ok := attrs["height"]; ok {
			return fmt.Errorf("height is for echarts; a diagram takes the height it needs")
		}
		if n.Lang == "sketch" {
			n.SVG, err = sketchSVG(n.source)
			return err
		}
		return checkDiagramColors(n.source)
	}
	n.height = 360
	if h, ok := attrs["height"]; ok {
		if n.height, err = strconv.Atoi(h); err != nil || n.height < 160 || n.height > 720 {
			return fmt.Errorf("height must be a number of pixels from 160 to 720")
		}
	}
	var option map[string]any
	if err := json.Unmarshal([]byte(n.source), &option); err != nil {
		return fmt.Errorf("the option must be a JSON object: %w", err)
	}
	if series, ok := option["series"].([]any); !ok || len(series) == 0 {
		return fmt.Errorf("the option's series must be a non-empty list")
	}
	if err := checkColors(option, false); err != nil {
		return err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, []byte(n.source)); err != nil {
		return err
	}
	n.source = compact.String()
	return nil
}

// checkColors keeps figures to the style.css palette, so every one of them
// follows the color scheme. Under a key that names a color (color,
// borderColor, inRange.color …) a string must be a token or a keyword, which
// also catches named colors such as "red".
func checkColors(v any, colorKey bool) error {
	switch v := v.(type) {
	case string:
		if fixedColor.MatchString(v) {
			return fmt.Errorf("color %q is fixed; use var(--name) with one of %s", v, strings.Join(figureTokens, ", "))
		}
		for _, m := range figureToken.FindAllStringSubmatch(v, -1) {
			if !slices.Contains(figureTokens, m[1]) {
				return fmt.Errorf("unknown color var(--%s); use one of %s", m[1], strings.Join(figureTokens, ", "))
			}
		}
		if colorKey && !figureToken.MatchString(v) && !slices.Contains(colorKeywords, v) {
			return fmt.Errorf("color %q is not var(--name); use one of %s", v, strings.Join(figureTokens, ", "))
		}
	case []any:
		for _, x := range v {
			if err := checkColors(x, colorKey); err != nil {
				return err
			}
		}
	case map[string]any:
		for k, x := range v {
			if err := checkColors(x, strings.Contains(strings.ToLower(k), "color")); err != nil {
				return err
			}
		}
	}
	return nil
}

// checkDiagramColors holds Mermaid's style, classDef and linkStyle lines to
// the same palette.
func checkDiagramColors(source string) error {
	for _, line := range strings.Split(source, "\n") {
		if word, _, _ := strings.Cut(strings.TrimSpace(line), " "); word != "style" && word != "classDef" && word != "linkStyle" {
			continue
		}
		for _, m := range diagramPaint.FindAllStringSubmatch(line, -1) {
			if t := figureToken.FindStringSubmatch(m[2]); t == nil || t[0] != m[2] || !slices.Contains(figureTokens, t[1]) {
				return fmt.Errorf("%s:%s is not var(--name); use one of %s", m[1], m[2], strings.Join(figureTokens, ", "))
			}
		}
	}
	return nil
}

func (figureRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindFigure, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		f := n.(*figureBlock)
		class, style := "diagram", ""
		if f.Lang == "echarts" {
			class, style = "echart", fmt.Sprintf(` style="--h:%dpx"`, f.height)
		} else if h := diagramHeight(f.SVG); h > 0 {
			// Where the page skips drawing the diagram, it holds this much room (style.css).
			style = fmt.Sprintf(` style="--h:%dpx"`, h)
		}
		title := html.EscapeString(f.title)
		fmt.Fprintf(w, `<figure class="%s"%s><figcaption>%s</figcaption><div class="figure-plot" role="img" aria-label="%s">%s</div>`, class, style, title, title, f.SVG)
		if f.Lang == "echarts" {
			// The option is compacted JSON; escaping <, > and & keeps it inside its script element.
			var option bytes.Buffer
			json.HTMLEscape(&option, []byte(f.source))
			fmt.Fprintf(w, `<script type="application/json">%s</script>`, option.String())
		}
		if f.note != "" {
			fmt.Fprintf(w, `<p class="figure-note">%s</p>`, html.EscapeString(f.note))
		}
		_, err := w.WriteString("</figure>\n")
		return ast.WalkSkipChildren, err
	})
}

// diagramHeight is how tall a diagram's SVG lays out in the reading column,
// or 0 when the SVG gives no size.
func diagramHeight(svg string) int {
	m := svgViewBox.FindStringSubmatch(svg)
	if m == nil {
		return 0
	}
	w, _ := strconv.ParseFloat(m[1], 64)
	h, _ := strconv.ParseFloat(m[2], 64)
	if w <= 0 {
		return 0
	}
	return int(math.Round(h * min(w, figureWidth) / w))
}

// figureDrawer runs render-figures.py once a build needs a drawing that is
// not cached, and keeps it for the rest of the build.
type figureDrawer struct {
	key    []byte // hashes everything a drawing depends on besides its request
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader
}

type figureRequest struct {
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// figureInputs are the files a drawing depends on besides its request,
// including the fonts render-figures.py measures text with.
var figureInputs = []string{figureScript, figureTheme, filepath.Join("static", echartsFile),
	"fonts/sans-400.woff2", "fonts/sans-500.woff2", "static/fonts/maple-mono-400.woff2", "static/fonts/maple-mono-500.woff2"}

// figureStandIns maps each token to the color the build draws it with.
// They are scattered through the color space by a hash, salted until no
// stand-in lies within 3 of the line between two others, so the drawing
// script can tell a mix of two, as a heatmap scale makes, from any single one
// (render-figures.py checks the same).
func figureStandIns() []byte {
	points := make([][3]float64, len(figureTokens))
	for salt := 0; ; salt++ {
		standIns := map[string]string{}
		for i, name := range figureTokens {
			sum := sha256.Sum256([]byte(fmt.Sprintf("stand-in %d %s", salt, name)))
			points[i] = [3]float64{float64(sum[0]), float64(sum[1]), float64(sum[2])}
			standIns[name] = fmt.Sprintf("#%02x%02x%02x", sum[0], sum[1], sum[2])
		}
		if separated(points) {
			data, _ := json.Marshal(standIns)
			return data
		}
	}
}

// separated reports whether no point lies within 3 of a segment between two others.
func separated(points [][3]float64) bool {
	for a := range points {
		for b := a + 1; b < len(points); b++ {
			p, q := points[a], points[b]
			d := [3]float64{q[0] - p[0], q[1] - p[1], q[2] - p[2]}
			length := d[0]*d[0] + d[1]*d[1] + d[2]*d[2]
			for c, r := range points {
				if c == a || c == b {
					continue
				}
				t := ((r[0]-p[0])*d[0] + (r[1]-p[1])*d[1] + (r[2]-p[2])*d[2]) / length
				if t <= 0 || t >= 1 {
					continue
				}
				x, y, z := r[0]-p[0]-t*d[0], r[1]-p[1]-t*d[1], r[2]-p[2]-t*d[2]
				if x*x+y*y+z*z < 9 {
					return false
				}
			}
		}
	}
	return true
}

// cached is where a figure's drawing is kept, named by everything it depends on.
func (d *figureDrawer) cached(request []byte) (string, error) {
	if d.key == nil {
		hash := sha256.New()
		for _, name := range figureInputs {
			data, err := os.ReadFile(name)
			if err != nil {
				return "", err
			}
			hash.Write(data)
		}
		hash.Write(figureStandIns())
		d.key = hash.Sum(nil)
	}
	return filepath.Join(figureCache, fmt.Sprintf("%x.svg", sha256.Sum256(append(d.key, request...)))), nil
}

// draw fills a parsed figure's SVG; a sketch is its own drawing.
func (d *figureDrawer) draw(f *figureBlock) error {
	if f.Lang == "sketch" {
		return nil
	}
	request, err := json.Marshal(figureRequest{f.Lang, f.source, figureWidth, f.height})
	if err != nil {
		return err
	}
	cached, err := d.cached(request)
	if err != nil {
		return err
	}
	if svg, err := os.ReadFile(cached); err == nil {
		f.SVG = string(svg)
		return nil
	}
	if d.cmd == nil {
		if err := d.start(); err != nil {
			return err
		}
	}
	var answer struct{ SVG, Error string }
	if _, err = d.stdin.Write(append(request, '\n')); err == nil {
		var line []byte
		if line, err = d.stdout.ReadBytes('\n'); err == nil {
			err = json.Unmarshal(line, &answer)
		}
	}
	if err != nil {
		return fmt.Errorf("draw figures (requires uv and Chrome): %w", err)
	}
	if answer.Error != "" {
		return errors.New(answer.Error)
	}
	if err = os.MkdirAll(figureCache, 0755); err != nil {
		return err
	}
	f.SVG = answer.SVG
	// Written whole or not at all: a build killed mid-write must not cache half an SVG.
	temp, err := os.CreateTemp(figureCache, "drawing-*")
	if err != nil {
		return err
	}
	if _, err = temp.WriteString(answer.SVG); err == nil {
		err = temp.Close()
	}
	if err == nil {
		err = os.Rename(temp.Name(), cached)
	}
	if err != nil {
		os.Remove(temp.Name())
	}
	return err
}

func (d *figureDrawer) start() error {
	d.cmd = exec.Command("uv", "run", "--script", figureScript, filepath.Join("static", echartsFile), string(figureStandIns()))
	d.cmd.Stderr = os.Stderr
	stdin, err := d.cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := d.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	d.stdin, d.stdout = stdin, bufio.NewReader(stdout)
	if err = d.cmd.Start(); err != nil {
		return fmt.Errorf("draw figures (requires uv): %w", err)
	}
	return nil
}

// close ends the drawing process, if the build started one.
func (d *figureDrawer) close() error {
	if d.cmd == nil {
		return nil
	}
	d.stdin.Close()
	err := d.cmd.Wait()
	d.cmd = nil
	return err
}
