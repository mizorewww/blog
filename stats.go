package main

import (
	"fmt"
	"html"
	"net/url"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// A ```stats fence is a card of headline numbers. "## " lines start a group
// (first word bold), other lines are label | value | detail. Values with a
// leading "+" take the accent color.
//
//	```stats title="35Δ 周末卖方策略" meta="Deribit · 208 周"
//	## BTC 单利币本位
//	总收益 | +1.166 | +116.6%
func renderStats(info string, lines []string) (string, error) {
	attrs, err := blockAttributes(info, []string{"title", "meta", "note"})
	if err != nil {
		return "", err
	}
	var b strings.Builder
	b.WriteString(`<figure class="stats">`)
	if attrs["title"] != "" || attrs["meta"] != "" {
		fmt.Fprintf(&b, `<figcaption><span>%s</span><span class="key">%s</span></figcaption>`, html.EscapeString(attrs["title"]), html.EscapeString(attrs["meta"]))
	}
	open := false
	closeGroup := func() {
		if open {
			b.WriteString("</dl>")
			open = false
		}
	}
	items := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
		case strings.HasPrefix(line, "## "):
			closeGroup()
			name, rest, _ := strings.Cut(strings.TrimSpace(line[3:]), " ")
			fmt.Fprintf(&b, `<p class="stats-group"><b>%s</b>%s</p>`, html.EscapeString(name), html.EscapeString(rest))
		default:
			cells := dataCells(line)
			if len(cells) < 2 || len(cells) > 3 {
				return "", fmt.Errorf("%q: write label | value | detail", line)
			}
			if !open {
				b.WriteString(`<dl class="kpi">`)
				open = true
			}
			class := ""
			if strings.HasPrefix(cells[1], "+") {
				class = ` class="up"`
			}
			fmt.Fprintf(&b, `<div><dt>%s</dt><dd%s>%s</dd>`, html.EscapeString(cells[0]), class, html.EscapeString(strings.Replace(cells[1], "-", "−", 1)))
			if len(cells) == 3 && cells[2] != "" {
				fmt.Fprintf(&b, `<dd class="s">%s</dd>`, html.EscapeString(cells[2]))
			}
			b.WriteString("</div>")
			items++
		}
	}
	closeGroup()
	if items == 0 {
		return "", fmt.Errorf("no label | value lines")
	}
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="data-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}

// A paragraph "::tv EXCHANGE:SYMBOL description" becomes a TradingView link
// card; live widgets need scripts, so the static site links out instead.
type tickerExtension struct{}

var kindTicker = ast.NewNodeKind("Ticker")

type tickerBlock struct {
	ast.BaseBlock
	Symbol, Label string
}

func (n *tickerBlock) Kind() ast.NodeKind            { return kindTicker }
func (n *tickerBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type tickerTransformer struct{}
type tickerRenderer struct{}

func (tickerExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(tickerTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(tickerRenderer{}, 100)))
}

func (tickerTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var found []*ast.Paragraph
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if p, ok := n.(*ast.Paragraph); entering && ok && p.Lines().Len() == 1 && strings.HasPrefix(paragraphText(p, reader.Source()), "::tv ") {
			found = append(found, p)
		}
		return ast.WalkContinue, nil
	})
	for _, p := range found {
		var words []string
		for _, word := range strings.Fields(paragraphText(p, reader.Source())[5:]) {
			if !strings.Contains(word, "=") {
				words = append(words, word)
			}
		}
		if len(words) == 0 {
			continue
		}
		p.Parent().ReplaceChild(p.Parent(), p, &tickerBlock{Symbol: words[0], Label: strings.Join(words[1:], " ")})
	}
}

func paragraphText(p *ast.Paragraph, source []byte) string {
	line := p.Lines().At(0)
	return string(line.Value(source))
}

func (tickerRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindTicker, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		t := n.(*tickerBlock)
		path := strings.ReplaceAll(t.Symbol, ":", "-")
		label := ""
		if t.Label != "" {
			label = `<span class="ticker-label">` + html.EscapeString(t.Label) + `</span>`
		}
		_, err := fmt.Fprintf(w, `<a class="ticker" href="https://www.tradingview.com/symbols/%s/"><span><b>%s</b>%s</span><span class="ticker-go">在 TradingView 查看 ↗</span></a>`+"\n", url.PathEscape(path), html.EscapeString(t.Symbol), label)
		return ast.WalkSkipChildren, err
	})
}
