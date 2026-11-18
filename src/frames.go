package main

import (
	"fmt"
	"html"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Fences that may show pictures (```frames, ```cases) hold their pictures as ast.Image
// children, so the build's image hook optimizes and publishes them like any
// other image; the fence renders them itself, in order, once they are
// processed. Lines are only split when the fence is found; they are checked
// when it renders, where an error can fail the build.
type mediaExtension struct{}

var kindMedia = ast.NewNodeKind("Media")

type mediaBlock struct {
	ast.BaseBlock
	Lang, Info string
	lines      []string
}

func (n *mediaBlock) Kind() ast.NodeKind            { return kindMedia }
func (n *mediaBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// A media fence names the image of each line it shows (or "") and renders
// itself from its lines and their processed images.
type mediaFence struct {
	image  func(line string) string
	render func(info string, lines []string, images []*ast.Image) (string, error)
}

var mediaFences = map[string]mediaFence{
	"frames": {frameImage, renderFrames},
	"cases":  {caseImage, renderCases},
}

type mediaTransformer struct{}
type mediaRenderer struct{}

func (mediaExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(mediaTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(mediaRenderer{}, 100)))
}

func (mediaTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var fences []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fence, ok := n.(*ast.FencedCodeBlock); entering && ok {
			if _, ok := mediaFences[string(fence.Language(reader.Source()))]; ok {
				fences = append(fences, fence)
			}
		}
		return ast.WalkContinue, nil
	})
	for _, fence := range fences {
		block := &mediaBlock{Lang: string(fence.Language(reader.Source())), Info: string(fence.Info.Segment.Value(reader.Source()))}
		for i := 0; i < fence.Lines().Len(); i++ {
			line := fence.Lines().At(i)
			block.lines = append(block.lines, strings.TrimRight(string(line.Value(reader.Source())), "\n"))
		}
		for _, line := range block.lines {
			if path := mediaFences[block.Lang].image(line); path != "" {
				block.AppendChild(block, ast.NewImage(ast.NewLink()))
				block.LastChild().(*ast.Image).Destination = []byte(path)
			}
		}
		fence.Parent().ReplaceChild(fence.Parent(), fence, block)
	}
}

func (mediaRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindMedia, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		block := n.(*mediaBlock)
		var images []*ast.Image
		for c := n.FirstChild(); c != nil; c = c.NextSibling() {
			images = append(images, c.(*ast.Image))
		}
		out, err := mediaFences[block.Lang].render(block.Info, block.lines, images)
		if err != nil {
			return ast.WalkStop, fmt.Errorf("%s block %q: %w", block.Lang, block.Info, err)
		}
		_, err = w.WriteString(out)
		return ast.WalkSkipChildren, err
	})
}

// imageTag writes a processed image; sizes is how wide it shows.
func imageTag(img *ast.Image, alt, sizes string) string {
	var b strings.Builder
	fmt.Fprintf(&b, `<img src="%s" alt="%s"`, html.EscapeString(string(img.Destination)), html.EscapeString(alt))
	for _, name := range []string{"width", "height", "srcset", "loading", "decoding", "fetchpriority"} {
		if v, ok := img.AttributeString(name); ok {
			fmt.Fprintf(&b, ` %s="%s"`, name, html.EscapeString(fmt.Sprint(attributeText(v))))
		}
	}
	if _, ok := img.AttributeString("srcset"); ok {
		fmt.Fprintf(&b, ` sizes="%s"`, sizes)
	}
	return b.String() + ">"
}

func attributeText(v any) string {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(v)
}

// imageSize is the pixel size the image hook found, or 0, 0.
func imageSize(img *ast.Image) (int, int) {
	w, _ := img.AttributeString("width")
	h, _ := img.AttributeString("height")
	width, _ := strconv.Atoi(attributeText(w))
	height, _ := strconv.Atoi(attributeText(h))
	return width, height
}

// A ```frames fence is a strip of video frames or photos with what a model
// said about each: P(present) as a number and a thin bar, and the model's box
// drawn over the picture where P clears the threshold. Each line is
//
//	image | label | P | x1,y1,x2,y2 | caption
//
// with the box in the image's pixels (size="W×H" when the boxes were
// measured on a different size than the file's) and box and caption optional.
// Everything is HTML and CSS; the boxes are placed in percent, so they stay
// on the picture at any width.
var frameAttributes = []string{"title", "note", "q", "cols", "threshold", "size"}

func frameImage(line string) string {
	if cells := dataCells(line); strings.TrimSpace(line) != "" && cells[0] != "" {
		return cells[0]
	}
	return ""
}

type frame struct {
	label, caption string
	p              float64
	box            []float64
}

func parseFrame(line string) (frame, error) {
	cells := dataCells(line)
	if len(cells) < 3 || len(cells) > 5 || cells[0] == "" {
		return frame{}, fmt.Errorf("%q: write image | label | P | x1,y1,x2,y2 | caption", line)
	}
	f := frame{label: cells[1]}
	var err error
	if f.p, err = strconv.ParseFloat(cells[2], 64); err != nil || f.p < 0 || f.p > 1 {
		return f, fmt.Errorf("%q: P must be a number from 0 to 1", line)
	}
	if len(cells) > 3 && cells[3] != "" {
		for _, v := range strings.Split(cells[3], ",") {
			x, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			if err != nil {
				return f, fmt.Errorf("%q: the box is x1,y1,x2,y2 in pixels", line)
			}
			f.box = append(f.box, x)
		}
		if len(f.box) != 4 || f.box[2] <= f.box[0] || f.box[3] <= f.box[1] {
			return f, fmt.Errorf("%q: the box is x1,y1,x2,y2 with x1 < x2 and y1 < y2", line)
		}
	}
	if len(cells) > 4 {
		f.caption = cells[4]
	}
	return f, nil
}

// frameSize reads size="854×480" (or 854x480).
func frameSize(s string) (float64, float64, error) {
	w, h, ok := strings.Cut(strings.ReplaceAll(s, "×", "x"), "x")
	width, err1 := strconv.ParseFloat(w, 64)
	height, err2 := strconv.ParseFloat(h, 64)
	if !ok || err1 != nil || err2 != nil || width <= 0 || height <= 0 {
		return 0, 0, fmt.Errorf(`size must be like "854x480"`)
	}
	return width, height, nil
}

func renderFrames(info string, lines []string, images []*ast.Image) (string, error) {
	attrs, err := blockAttributes(info, frameAttributes)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(attrs["title"]) == "" {
		return "", fmt.Errorf("needs a title")
	}
	if len(images) == 0 {
		return "", fmt.Errorf("no image | label | P lines")
	}
	cols, threshold := len(images), 0.5
	if attrs["cols"] != "" {
		if cols, err = strconv.Atoi(attrs["cols"]); err != nil || cols < 1 || cols > 8 {
			return "", fmt.Errorf("cols must be 1 to 8")
		}
	}
	if attrs["threshold"] != "" {
		if threshold, err = strconv.ParseFloat(attrs["threshold"], 64); err != nil || threshold <= 0 || threshold >= 1 {
			return "", fmt.Errorf("threshold must be between 0 and 1")
		}
	}
	var sizeW, sizeH float64
	if attrs["size"] != "" {
		if sizeW, sizeH, err = frameSize(attrs["size"]); err != nil {
			return "", err
		}
	}
	cols = min(cols, len(images))
	var b strings.Builder
	// Phones fit three across at most.
	fmt.Fprintf(&b, `<figure class="frames" style="--cols:%d;--cols-n:%d"><figcaption>%s</figcaption>`, cols, min(cols, 3), html.EscapeString(attrs["title"]))
	if attrs["q"] != "" {
		fmt.Fprintf(&b, `<p class="frames-q">%s</p>`, html.EscapeString(attrs["q"]))
	}
	b.WriteString(`<ol class="frames-strip">`)
	sizes := fmt.Sprintf("(max-width: 640px) %dvw, %dpx", 100/min(cols, 3), 704/cols)
	i := 0
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f, err := parseFrame(line)
		if err != nil {
			return "", err
		}
		img := images[i]
		i++
		present := f.p >= threshold
		class := "out"
		if present {
			class = "in"
		}
		alt := strings.TrimSpace(fmt.Sprintf("%s P=%.2f %s", f.label, f.p, f.caption))
		fmt.Fprintf(&b, `<li class="%s"><div class="shot">%s`, class, imageTag(img, alt, sizes))
		if f.box != nil && present {
			w, h := sizeW, sizeH
			if w == 0 {
				iw, ih := imageSize(img)
				if iw == 0 || ih == 0 {
					return "", fmt.Errorf("%q: the image has no pixel size; give size=\"W×H\" for the boxes", line)
				}
				w, h = float64(iw), float64(ih)
			}
			// Boxes may run past the picture by a pixel or two; draw them inside it.
			x1, y1 := max(f.box[0], 0)/w*100, max(f.box[1], 0)/h*100
			x2, y2 := min(f.box[2]/w*100, 100), min(f.box[3]/h*100, 100)
			fmt.Fprintf(&b, `<span class="box" style="left:%.1f%%;top:%.1f%%;width:%.1f%%;height:%.1f%%"></span>`, x1, y1, x2-x1, y2-y1)
		}
		fmt.Fprintf(&b, `</div><p class="frames-p"><span>%s</span><b>P %.2f</b></p><span class="frames-bar" style="--p:%.0f%%"></span>`, html.EscapeString(f.label), f.p, f.p*100)
		if f.caption != "" {
			fmt.Fprintf(&b, `<p class="frames-cap">%s</p>`, html.EscapeString(f.caption))
		}
		b.WriteString("</li>")
	}
	b.WriteString("</ol>")
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="figure-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
