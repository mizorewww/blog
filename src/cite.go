package main

import (
	"bytes"
	"fmt"
	"html"
	"regexp"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// [@key] in the text cites a reference; a list item that starts with [@key]
// defines it. The lists of definitions become one numbered list, possibly
// split by headings, in the order they appear:
//
//	一项元分析[@mccomb2023]发现……
//
//	## 参考资料
//	- [@mccomb2023] McComb, C. A., … (2023). [Title](https://doi.org/…).
//
// A citation is a superscript [n] linking to its reference, which links back.
type citeExtension struct{ back string }

var (
	kindCitation = ast.NewNodeKind("Citation")
	citeKey      = regexp.MustCompile(`^\[@([A-Za-z0-9][A-Za-z0-9_-]*)\]`)
)

type citation struct {
	ast.BaseInline
	Key    string
	Number int
	ID     string   // a citation's own anchor, which its reference links back to
	Back   []string // a definition's citations; nil for a citation
	def    bool
}

func (n *citation) Kind() ast.NodeKind            { return kindCitation }
func (n *citation) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type citeParser struct{}
type citeRenderer struct{ back string }

func (citeParser) Trigger() []byte { return []byte{'['} }

func (citeParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, _ := block.PeekLine()
	m := citeKey.FindSubmatch(line)
	if m == nil {
		return nil
	}
	// [@name](url) and [@name][label] stay links, such as to a GitHub user;
	// [@a][@b] is two citations.
	if rest := line[len(m[0]):]; bytes.HasPrefix(rest, []byte("(")) || bytes.HasPrefix(rest, []byte("[")) && !bytes.HasPrefix(rest, []byte("[@")) {
		return nil
	}
	block.Advance(len(m[0]))
	return &citation{Key: string(m[1])}
}

func (e citeExtension) Extend(m goldmark.Markdown) {
	// Before the link parser, which would otherwise read [@key] as link text.
	m.Parser().AddOptions(parser.WithInlineParsers(util.Prioritized(citeParser{}, 199)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(citeRenderer{e.back}, 100)))
}

// definitionItem is the list item a citation defines, when it opens one.
func definitionItem(n *citation) *ast.ListItem {
	block := n.Parent()
	if block == nil || block.FirstChild() != n {
		return nil
	}
	item, ok := block.Parent().(*ast.ListItem)
	if !ok || item.FirstChild() != block {
		return nil
	}
	return item
}

// resolveCitations numbers references in the order they are defined and
// links each citation to its reference and back. A citation without a
// reference, a key defined twice, or a list that mixes references with other
// items fails the build.
func resolveCitations(doc ast.Node) error {
	var defs, cites []*citation
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if c, ok := n.(*citation); entering && ok {
			if c.def = definitionItem(c) != nil; c.def {
				defs = append(defs, c)
			} else {
				cites = append(cites, c)
			}
		}
		return ast.WalkContinue, nil
	})
	refs := map[string]*citation{}
	seenLists := map[*ast.List]bool{}
	for i, d := range defs {
		if refs[d.Key] != nil {
			return fmt.Errorf("reference [@%s] is defined twice", d.Key)
		}
		refs[d.Key], d.Number = d, i+1
		item := definitionItem(d)
		item.SetAttributeString("id", "ref-"+d.Key)
		list := item.Parent().(*ast.List)
		if seenLists[list] {
			continue
		}
		seenLists[list] = true
		for li := list.FirstChild(); li != nil; li = li.NextSibling() {
			var first ast.Node
			if li.FirstChild() != nil {
				first = li.FirstChild().FirstChild()
			}
			if c, ok := first.(*citation); !ok || definitionItem(c) == nil {
				return fmt.Errorf("the list of [@%s] mixes references with other items", d.Key)
			}
		}
		list.Marker, list.Start = '.', d.Number
		list.SetAttributeString("class", "references")
	}
	for _, c := range cites {
		ref := refs[c.Key]
		if ref == nil {
			return fmt.Errorf("citation [@%s] has no reference; define it in a list item starting with [@%s]", c.Key, c.Key)
		}
		c.Number = ref.Number
		c.ID = fmt.Sprintf("cite-%s-%d", c.Key, len(ref.Back)+1)
		ref.Back = append(ref.Back, c.ID)
	}
	return nil
}

// A citation renders as [n]; a definition as links back to where it is cited,
// numbered when there are several, as on Wikipedia.
func (cr citeRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindCitation, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		c := n.(*citation)
		if !entering || c.Number == 0 {
			return ast.WalkContinue, nil
		}
		if !c.def {
			fmt.Fprintf(w, `<sup class="cite"><a id="%s" href="#ref-%s">[%d]</a></sup>`, html.EscapeString(c.ID), html.EscapeString(c.Key), c.Number)
			return ast.WalkContinue, nil
		}
		if len(c.Back) == 0 {
			return ast.WalkContinue, nil
		}
		w.WriteString(`<span class="ref-back">`)
		if len(c.Back) == 1 {
			fmt.Fprintf(w, `<a href="#%s" aria-label="%s">↑</a>`, html.EscapeString(c.Back[0]), html.EscapeString(cr.back))
		} else {
			w.WriteString(`<span aria-hidden="true">↑</span>`)
			for i, id := range c.Back {
				fmt.Fprintf(w, ` <a href="#%s" aria-label="%s %d">%d</a>`, html.EscapeString(id), html.EscapeString(cr.back), i+1, i+1)
			}
		}
		w.WriteString(`</span>`)
		return ast.WalkContinue, nil
	})
}
