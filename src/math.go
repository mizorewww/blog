package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

//go:embed mathjax.js.gz
var mathjaxBundle []byte

const mathCacheDir = ".cache/math"

// LaTeX between $…$ (inline) or on $$ lines (display) becomes crisp build-time
// SVG via MathJax 3 tex2svg, with zero client-side scripts or web font loads.
type mathExtension struct{}

var (
	kindMath              = ast.NewNodeKind("Math")
	kindMathBlock         = ast.NewNodeKind("MathBlock")
	mathDefsRe            = regexp.MustCompile(`(?s)<defs>(.*?)</defs>`)
	mathPathRe            = regexp.MustCompile(`<path id="(MJX-TEX-[^"]+)" d="([^"]*)"></path>`)
	mathHrefRe            = regexp.MustCompile(`#(MJX-TEX-[^"]+)`)
	mathTranslateZeroRe   = regexp.MustCompile(`translate\((-?[\d.]+),0\)`)
	mathWidthHeightAttrRe = regexp.MustCompile(`\s(?:width|height)="[\d.]+ex"`)
	mathMetricsRe         = regexp.MustCompile(`^<svg class="math-svg"\swidth="([\d.]+)ex"\sheight="([\d.]+)ex"[^>]*\sviewBox="([^"]+)">(.*)</svg>$`)
	mathOnce              sync.Once
	mathProg              *goja.Program
	mathInitErr           error
	mathBundleHash        string
	mathDiskCache         bool
	mathMemCache          sync.Map
	mathPool              sync.Pool
)

type mathRuntime struct {
	vm     *goja.Runtime
	render goja.Callable
}

type mathInline struct {
	ast.BaseInline
	TeX []byte
}

func (n *mathInline) Kind() ast.NodeKind                            { return kindMath }
func (n *mathInline) Dump(source []byte, level int)                 { ast.DumpHelper(n, source, level, nil, nil) }
func (n *mathBlock) Kind() ast.NodeKind                             { return kindMathBlock }
func (n *mathBlock) Dump(source []byte, level int)                  { ast.DumpHelper(n, source, level, nil, nil) }
func (n *mathBlock) IsRaw() bool                                    { return true }
func (mathInlineParser) Trigger() []byte                            { return []byte{'$'} }
func (mathBlockParser) Trigger() []byte                             { return []byte{'$'} }
func (mathBlockParser) CanInterruptParagraph() bool                 { return true }
func (mathBlockParser) CanAcceptIndentedLine() bool                 { return false }
func (mathBlockParser) Close(ast.Node, text.Reader, parser.Context) {}

type mathBlock struct{ ast.BaseBlock }
type mathInlineParser struct{}
type mathBlockParser struct{}
type mathRenderer struct{}

func (mathExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithInlineParsers(util.Prioritized(mathInlineParser{}, 500)),
		parser.WithBlockParsers(util.Prioritized(mathBlockParser{}, 700)),
	)
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(mathRenderer{}, 500)))
}

// Pandoc's rule keeps prices literal: no space after the opening $, and the
// closing $ follows a non-space and is not followed by a digit ($5 and $10).
func (mathInlineParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, _ := block.PeekLine()
	fence := 1
	if len(line) > 1 && line[1] == '$' {
		fence = 2
	}
	body := line[fence:]
	if len(body) == 0 || body[0] == ' ' || body[0] == '\t' || body[0] == '$' {
		return nil
	}
	for i := 0; i < len(body); i++ {
		switch {
		case body[i] == '\\':
			i++
		case body[i] == '`':
			return nil // a code span starts first; never wrap it in math
		case i == 0 || body[i] != '$' || body[i-1] == ' ' || body[i-1] == '\t':
		case fence == 2 && (i+1 >= len(body) || body[i+1] != '$'):
		case fence == 1 && i+1 < len(body) && body[i+1] >= '0' && body[i+1] <= '9':
		default:
			block.Advance(fence + i + fence)
			return &mathInline{TeX: body[:i]}
		}
	}
	return nil
}

func (mathBlockParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, _ := reader.PeekLine()
	if pos := pc.BlockOffset(); pos < 0 || string(bytes.TrimSpace(line[pos:])) != "$$" {
		return nil, parser.NoChildren
	}
	reader.AdvanceToEOL()
	return &mathBlock{}, parser.NoChildren
}

func (mathBlockParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	line, segment := reader.PeekLine()
	if string(bytes.TrimSpace(line)) == "$$" {
		reader.AdvanceToEOL()
		return parser.Close
	}
	node.Lines().Append(segment)
	reader.AdvanceToEOL()
	return parser.Continue | parser.NoChildren
}

func (mathRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindMath, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, _ = w.WriteString(`<span class="math-inline">`)
			err := writeMath(w, string(n.(*mathInline).TeX), false)
			_, _ = w.WriteString("</span>")
			return ast.WalkSkipChildren, err
		}
		return ast.WalkContinue, nil
	})
	r.Register(kindMathBlock, func(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var tex bytes.Buffer
		for i := 0; i < n.Lines().Len(); i++ {
			line := n.Lines().At(i)
			tex.Write(line.Value(source))
		}
		_, _ = w.WriteString(`<div class="math" tabindex="0">`)
		err := writeMath(w, tex.String(), true)
		_, _ = w.WriteString("</div>\n")
		return ast.WalkSkipChildren, err
	})
}

func initMathEngine() {
	sum := sha256.Sum256(mathjaxBundle)
	mathBundleHash = fmt.Sprintf("%x", sum[:6])
	if _, err := os.Stat("site.json"); err == nil {
		mathDiskCache = true
	}
	zr, err := gzip.NewReader(bytes.NewReader(mathjaxBundle))
	if err != nil {
		mathInitErr = err
		return
	}
	defer zr.Close()
	js, err := io.ReadAll(zr)
	if err != nil {
		mathInitErr = err
		return
	}
	mathProg, mathInitErr = goja.Compile("mathjax.js", string(js), true)
}

func acquireMathRuntime() (*mathRuntime, error) {
	mathOnce.Do(initMathEngine)
	if mathInitErr != nil {
		return nil, mathInitErr
	}
	if cached := mathPool.Get(); cached != nil {
		return cached.(*mathRuntime), nil
	}
	vm := goja.New()
	if _, err := vm.RunProgram(mathProg); err != nil {
		return nil, err
	}
	fn, ok := goja.AssertFunction(vm.Get("renderTeX"))
	if !ok {
		return nil, fmt.Errorf("mathjax bundle missing renderTeX")
	}
	return &mathRuntime{vm: vm, render: fn}, nil
}

// writeMath compiles TeX into an inline or display SVG and writes it to w.
func writeMath(w util.BufWriter, tex string, display bool) error {
	out, err := mathString(tex, display)
	if err != nil {
		return err
	}
	_, err = w.WriteString(out)
	return err
}

func mathSVG(tex string, display bool) (string, error) {
	trimmed := strings.TrimSpace(tex)
	if trimmed == "" {
		return "", fmt.Errorf("empty formula")
	}
	mathOnce.Do(initMathEngine)
	if mathInitErr != nil {
		return "", mathInitErr
	}
	key := fmt.Sprintf("%s:%t:%s", mathBundleHash, display, trimmed)
	if v, ok := mathMemCache.Load(key); ok {
		return v.(string), nil
	}
	var diskFile string
	if mathDiskCache {
		sum := sha256.Sum256([]byte(key))
		diskFile = filepath.Join(mathCacheDir, fmt.Sprintf("%x.svg", sum[:16]))
		if b, err := os.ReadFile(diskFile); err == nil && strings.HasPrefix(string(b), `<svg class="math-svg"`) {
			s := string(b)
			mathMemCache.Store(key, s)
			return s, nil
		}
	}
	rt, err := acquireMathRuntime()
	if err != nil {
		return "", err
	}
	val, callErr := rt.render(goja.Undefined(), rt.vm.ToValue(trimmed), rt.vm.ToValue(display))
	mathPool.Put(rt)
	if callErr != nil {
		return "", fmt.Errorf("math %q: %w", tex, callErr)
	}
	svg := strings.TrimSpace(val.String())
	mathMemCache.Store(key, svg)
	if diskFile != "" {
		if err := os.MkdirAll(mathCacheDir, 0755); err == nil {
			if tmp, err := os.CreateTemp(mathCacheDir, "*.tmp"); err == nil {
				_, wErr := tmp.WriteString(svg)
				cErr := tmp.Close()
				if wErr == nil && cErr == nil {
					_ = os.Rename(tmp.Name(), diskFile)
				} else {
					_ = os.Remove(tmp.Name())
				}
			}
		}
	}
	return svg, nil
}

func mathString(tex string, display bool) (string, error) {
	svg, err := mathSVG(tex, display)
	if err != nil {
		return "", err
	}
	// Drop presentation width/height in HTML (already in inline style) and attach aria-label.
	svg = mathWidthHeightAttrRe.ReplaceAllString(svg, "")
	label := html.EscapeString(strings.Join(strings.Fields(tex), " "))
	return strings.Replace(svg, `<svg class="math-svg" `, `<svg class="math-svg" role="img" aria-label="`+label+`" `, 1), nil
}

// sketchMathSVG returns a formula's dimensions (in ex), viewBox and inner SVG
// markup so <sketch> can position it as pure vector paths without foreignObject.
func sketchMathSVG(tex string, display bool) (widthEx, heightEx float64, viewBox, inner string, err error) {
	svg, err := mathSVG(tex, display)
	if err != nil {
		return 0, 0, "", "", err
	}
	m := mathMetricsRe.FindStringSubmatch(svg)
	if m == nil {
		return 0, 0, "", "", fmt.Errorf("unexpected MathJax SVG format for %q", tex)
	}
	widthEx, err = strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0, 0, "", "", err
	}
	heightEx, err = strconv.ParseFloat(m[2], 64)
	if err != nil {
		return 0, 0, "", "", err
	}
	return widthEx, heightEx, m[3], m[4], nil
}

// replaceMathSVGs visits every top-level <svg class="math-svg">…</svg> in page,
// tracking nested <svg> tags (emitted by MathJax mtable / stretchy assemblies).
func replaceMathSVGs(page string, fn func(openTag, inner string) string) string {
	const marker = `<svg class="math-svg"`
	var out strings.Builder
	out.Grow(len(page))
	pos := 0
	for {
		rel := strings.Index(page[pos:], marker)
		if rel < 0 {
			out.WriteString(page[pos:])
			return out.String()
		}
		start := pos + rel
		out.WriteString(page[pos:start])
		gt := strings.IndexByte(page[start:], '>')
		if gt < 0 {
			out.WriteString(page[start:])
			return out.String()
		}
		innerStart := start + gt + 1
		depth := 1
		cur := innerStart
		end := -1
		for depth > 0 {
			nextOpen := strings.Index(page[cur:], "<svg")
			nextClose := strings.Index(page[cur:], "</svg>")
			if nextClose < 0 {
				break
			}
			if nextOpen >= 0 && nextOpen < nextClose {
				after := cur + nextOpen + 4
				if after < len(page) && (page[after] == ' ' || page[after] == '>' || page[after] == '\t' || page[after] == '\n') {
					depth++
				}
				cur = after
			} else {
				depth--
				if depth == 0 {
					end = cur + nextClose
					break
				}
				cur = cur + nextClose + len("</svg>")
			}
		}
		if end < 0 {
			out.WriteString(page[start:])
			return out.String()
		}
		out.WriteString(fn(page[start:innerStart], page[innerStart:end]))
		pos = end + len("</svg>")
	}
}

// hoistMathDefs collects repeated MJX-TEX-* glyph <path> definitions from all
// .math-svg elements on a rendered HTML page into one shared <defs> block.
func hoistMathDefs(page string) string {
	if !strings.Contains(page, `<svg class="math-svg"`) {
		return page
	}
	pathD := map[string]string{}
	stripped := replaceMathSVGs(page, func(openTag, inner string) string {
		inner = mathDefsRe.ReplaceAllStringFunc(inner, func(defs string) string {
			dBody := defs[len("<defs>") : len(defs)-len("</defs>")]
			rest := mathPathRe.ReplaceAllStringFunc(dBody, func(p string) string {
				m := mathPathRe.FindStringSubmatch(p)
				pathD[m[1]] = m[2]
				return ""
			})
			if strings.TrimSpace(rest) == "" {
				return ""
			}
			return "<defs>" + rest + "</defs>"
		})
		inner = strings.ReplaceAll(inner, "></use>", "/>")
		inner = mathTranslateZeroRe.ReplaceAllString(inner, "translate($1)")
		return openTag + inner + "</svg>"
	})
	if len(pathD) == 0 {
		return stripped
	}
	origIDs := make([]string, 0, len(pathD))
	for id := range pathD {
		origIDs = append(origIDs, id)
	}
	slices.Sort(origIDs)
	shortID := make(map[string]string, len(origIDs))
	for i, id := range origIDs {
		shortID[id] = "mjx-" + strconv.FormatInt(int64(i), 36)
	}
	rewritten := replaceMathSVGs(stripped, func(openTag, inner string) string {
		inner = mathHrefRe.ReplaceAllStringFunc(inner, func(ref string) string {
			if s, ok := shortID[ref[1:]]; ok {
				return "#" + s
			}
			return ref
		})
		return openTag + inner + "</svg>"
	})
	var shared strings.Builder
	shared.WriteString(`<svg aria-hidden="true" class="math-defs"><defs>`)
	for _, id := range origIDs {
		shared.WriteString(`<path id="`)
		shared.WriteString(shortID[id])
		shared.WriteString(`" d="`)
		shared.WriteString(pathD[id])
		shared.WriteString(`"/>`)
	}
	shared.WriteString(`</defs></svg>`)
	if idx := strings.LastIndex(rewritten, "</body>"); idx >= 0 {
		return rewritten[:idx] + shared.String() + rewritten[idx:]
	}
	return rewritten + shared.String()
}

// inlineMathHTML escapes plain text for HTML while compiling $…$ spans into
// inline SVG formulas under Pandoc's delimiter rule (so $5 and $10 stay literal).
func inlineMathHTML(s string) (string, error) {
	if !strings.Contains(s, "$") {
		return html.EscapeString(s), nil
	}
	var out strings.Builder
	for i := 0; i < len(s); {
		if s[i] == '\\' && i+1 < len(s) && s[i+1] == '$' {
			out.WriteByte('$')
			i += 2
			continue
		}
		if s[i] != '$' {
			j := i + 1
			for j < len(s) && s[j] != '$' && !(s[j] == '\\' && j+1 < len(s) && s[j+1] == '$') {
				j++
			}
			out.WriteString(html.EscapeString(s[i:j]))
			i = j
			continue
		}
		fence := 1
		if i+1 < len(s) && s[i+1] == '$' {
			fence = 2
		}
		body := s[i+fence:]
		if len(body) == 0 || body[0] == ' ' || body[0] == '\t' || body[0] == '$' {
			out.WriteString(strings.Repeat("$", fence))
			i += fence
			continue
		}
		end := -1
		for k := 0; k < len(body); k++ {
			switch {
			case body[k] == '\\':
				k++
			case body[k] == '`':
				k = len(body)
			case k == 0 || body[k] != '$' || body[k-1] == ' ' || body[k-1] == '\t':
			case fence == 2 && (k+1 >= len(body) || body[k+1] != '$'):
			case fence == 1 && k+1 < len(body) && body[k+1] >= '0' && body[k+1] <= '9':
			default:
				end = k
			}
			if end >= 0 {
				break
			}
		}
		if end < 0 {
			out.WriteString(strings.Repeat("$", fence))
			i += fence
			continue
		}
		svg, err := mathString(body[:end], false)
		if err != nil {
			return "", err
		}
		out.WriteString(`<span class="math-inline">`)
		out.WriteString(svg)
		out.WriteString(`</span>`)
		i += fence + end + fence
	}
	return out.String(), nil
}

// plainMathLabel strips inline $ delimiters for plain-text attributes like aria-label.
func plainMathLabel(s string) string {
	if !strings.Contains(s, "$") {
		return s
	}
	clean := strings.ReplaceAll(s, `\$`, "$")
	var out strings.Builder
	for i := 0; i < len(clean); i++ {
		if clean[i] != '$' {
			out.WriteByte(clean[i])
		}
	}
	return out.String()
}
