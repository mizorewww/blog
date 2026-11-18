package main

import (
	"crypto/sha256"
	"fmt"
	"html"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// A ```widget fence is a figure a post scripts itself: an ES module in a
// folder under content/ that draws into the figure once the page has loaded.
// The fence's lines are still pictures of it, which go through the image
// pipeline and are what readers without JavaScript, feed readers and the
// first paint see:
//
//	```widget src="../widgets/glance/hero.js" title="…" note="…"
//	../images/glance/hero.png | what the picture shows
//	../images/glance/hero-narrow.png | the same, laid out for phones
//	```
//
// The second picture is optional and replaces the first at 640 px and below. The module's
// whole folder is published under /widgets/<folder>-<hash>/, so it may import
// and fetch its neighbours by relative URL, and a changed file gets a new URL.
var widgetAttributes = []string{"title", "note", "src"}

type widgetExtension struct{}

var kindWidget = ast.NewNodeKind("Widget")

type widgetBlock struct {
	ast.BaseBlock
	Info  string
	lines []string
	Src   string // the module's published URL, set by the build's widget hook
}

func (n *widgetBlock) Kind() ast.NodeKind            { return kindWidget }
func (n *widgetBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

// attrs reads and checks the fence's attributes.
func (n *widgetBlock) attrs() (map[string]string, error) {
	attrs, err := blockAttributes(n.Info, widgetAttributes)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(attrs["title"]) == "" {
		return nil, fmt.Errorf("needs a title")
	}
	if !strings.HasSuffix(attrs["src"], ".js") {
		return nil, fmt.Errorf(`needs src="…/name.js", the module that draws the figure`)
	}
	return attrs, nil
}

type widgetTransformer struct{}
type widgetRenderer struct{}

func (widgetExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(widgetTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(widgetRenderer{}, 100)))
}

func (widgetTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var fences []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fence, ok := n.(*ast.FencedCodeBlock); entering && ok && string(fence.Language(reader.Source())) == "widget" {
			fences = append(fences, fence)
		}
		return ast.WalkContinue, nil
	})
	for _, fence := range fences {
		block := &widgetBlock{Info: string(fence.Info.Segment.Value(reader.Source()))}
		for i := 0; i < fence.Lines().Len(); i++ {
			line := fence.Lines().At(i)
			if s := strings.TrimSpace(string(line.Value(reader.Source()))); s != "" {
				block.lines = append(block.lines, s)
			}
		}
		// The pictures are children, so the image hook publishes them like any other.
		for _, line := range block.lines {
			if cells := dataCells(line); cells[0] != "" {
				block.AppendChild(block, ast.NewImage(ast.NewLink()))
				block.LastChild().(*ast.Image).Destination = []byte(cells[0])
			}
		}
		fence.Parent().ReplaceChild(fence.Parent(), fence, block)
	}
}

func (widgetRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindWidget, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		block := n.(*widgetBlock)
		out, err := renderWidget(block)
		if err != nil {
			return ast.WalkStop, fmt.Errorf("widget block %q: %w", block.Info, err)
		}
		_, err = w.WriteString(out)
		return ast.WalkSkipChildren, err
	})
}

func renderWidget(block *widgetBlock) (string, error) {
	attrs, err := block.attrs()
	if err != nil {
		return "", err
	}
	var images []*ast.Image
	for c := block.FirstChild(); c != nil; c = c.NextSibling() {
		images = append(images, c.(*ast.Image))
	}
	if len(images) == 0 || len(images) > 2 || len(images) != len(block.lines) {
		return "", fmt.Errorf("write one or two lines image | alt: the still picture, and optionally one for phones")
	}
	var b strings.Builder
	src := block.Src
	if src == "" {
		src = attrs["src"] // no build hook, as in tests that render a fragment
	}
	fmt.Fprintf(&b, `<figure class="widget" data-src="%s"><figcaption>%s</figcaption><div class="widget-stage">`, html.EscapeString(src), html.EscapeString(attrs["title"]))
	wide := images[0]
	alt := attrs["title"]
	if cells := dataCells(block.lines[0]); len(cells) > 1 && cells[1] != "" {
		alt = cells[1]
	}
	if len(images) == 2 {
		// One picture element, so a phone fetches only its own still.
		narrow := images[1]
		srcset := string(narrow.Destination)
		if v, ok := narrow.AttributeString("srcset"); ok {
			srcset = attributeText(v)
		}
		b.WriteString(`<picture><source media="(max-width: 640px)" srcset="` + html.EscapeString(srcset) + `" sizes="calc(100vw - 32px)"`)
		if w, h := imageSize(narrow); w > 0 && h > 0 {
			fmt.Fprintf(&b, ` width="%d" height="%d"`, w, h)
		}
		b.WriteString(">")
	}
	b.WriteString(strings.Replace(imageTag(wide, alt, "(max-width: 760px) calc(100vw - 64px), 704px"), "<img ", `<img class="widget-still" `, 1))
	if len(images) == 2 {
		b.WriteString("</picture>")
	}
	b.WriteString(`</div>`)
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="figure-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}

// widgetPublisher copies each widget folder a post uses into the build once.
type widgetPublisher struct {
	stage, prefix string
	published     map[string]string // folder → its URL path
	text          map[string]string // folder → the text of its scripts and data
}

// hook resolves a widget's src against its post and publishes the folder.
// The text of the folder's scripts and data is added to scripted, so the
// post's font subsets cover what the widget will draw.
func (p *widgetPublisher) hook(document string, scripted *string) func(*widgetBlock) error {
	return func(block *widgetBlock) error {
		attrs, err := block.attrs()
		if err != nil {
			return err
		}
		entry := filepath.Join(filepath.Dir(document), filepath.FromSlash(attrs["src"]))
		if _, err := os.Stat(entry); err != nil {
			return fmt.Errorf("src: %w", err)
		}
		folder, err := filepath.Abs(filepath.Dir(entry))
		if err != nil {
			return err
		}
		content, err := filepath.Abs("content")
		if err != nil {
			return err
		}
		if rel, err := filepath.Rel(content, folder); err != nil || rel == "." || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("src must be a module in a folder under content/, like content/widgets/<name>/: %s", attrs["src"])
		}
		if p.published == nil {
			p.published, p.text = map[string]string{}, map[string]string{}
		}
		base, ok := p.published[folder]
		if !ok {
			if base, err = p.publish(folder); err != nil {
				return err
			}
			p.published[folder] = base
		}
		if !strings.Contains(*scripted, p.text[folder]) {
			*scripted += p.text[folder]
		}
		block.Src = base + filepath.Base(entry)
		return nil
	}
}

// publish copies a folder to /widgets/<name>-<hash of its files>/.
func (p *widgetPublisher) publish(folder string) (string, error) {
	hash := sha256.New()
	files := map[string][]byte{}
	var names []string
	err := filepath.WalkDir(folder, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			return err
		}
		name, err := filepath.Rel(folder, path)
		if err != nil {
			return err
		}
		if files[name], err = os.ReadFile(path); err != nil {
			return err
		}
		names = append(names, name) // WalkDir walks in lexical order
		if ext := filepath.Ext(name); ext == ".js" || ext == ".json" {
			p.text[folder] += string(files[name])
		}
		fmt.Fprintf(hash, "%s\x00%d\x00", filepath.ToSlash(name), len(files[name]))
		hash.Write(files[name])
		return nil
	})
	if err != nil {
		return "", err
	}
	dir := fmt.Sprintf("widgets/%s-%x", filepath.Base(folder), hash.Sum(nil)[:6])
	for _, name := range names {
		target := filepath.Join(p.stage, dir, name)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(target, files[name], 0644); err != nil {
			return "", err
		}
	}
	return p.prefix + "/" + dir + "/", nil
}
