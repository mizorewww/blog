package main

import (
	"fmt"
	"html"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var (
	kpiTrailingUnit  = regexp.MustCompile(`^([+−-]?\d[\d.,/%a-zA-Z–-]*)(\s+\S.*)$`)
	kpiDetailNegSign = regexp.MustCompile(`(^|[\s(（·])-(\d)`)
)

// splitStatsGroup separates a "## " group line into its bold title and optional
// muted qualifier without slicing multi-word titles or parentheticals in half.
func splitStatsGroup(s string) (string, string) {
	if i := strings.IndexAny(s, "(（"); i > 0 {
		return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i:])
	}
	first, after, ok := strings.Cut(s, " ")
	if !ok {
		return s, ""
	}
	after = strings.TrimSpace(after)
	hasCJK := strings.ContainsFunc(s, func(r rune) bool { return unicode.Is(unicode.Han, r) })
	allCaps := first != "" && strings.ToUpper(first) == first && strings.ContainsFunc(first, unicode.IsLetter)
	var nextRune rune
	for _, r := range after {
		nextRune = r
		break
	}
	if hasCJK || allCaps || !unicode.IsUpper(nextRune) {
		return first, after
	}
	return s, ""
}

// kpiCols picks a balanced column count so groups of 2, 3, 4, 6, or 8 items
// never leave an awkward empty slot at the end of a row.
func kpiCols(n int) int {
	switch {
	case n <= 1:
		return 1
	case n == 2:
		return 2
	case n == 3 || n == 5 || n == 6:
		return 3
	default:
		return 4
	}
}

func formatKPIValue(raw string) string {
	val := strings.Replace(raw, "-", "−", 1)
	if m := kpiTrailingUnit.FindStringSubmatch(val); m != nil {
		return html.EscapeString(m[1]) + `<span class="kpi-u">` + html.EscapeString(m[2]) + `</span>`
	}
	return html.EscapeString(val)
}

// A ```stats fence is a set of headline numbers. "## " lines start a group,
// other lines are label | value | detail. Values with a leading "+" take the
// accent color.
//
//	```stats title="35Δ 周末卖方策略" meta="Deribit · 208 周"
//	## BTC 单利币本位
//	总收益 | +1.166 | +116.6%
func renderStats(info string, lines []string) (string, error) {
	attrs, err := blockAttributes(info, []string{"title", "meta", "note"})
	if err != nil {
		return "", err
	}
	type statsGroup struct {
		name, rest string
		hasHeader  bool
		rows       [][]string
	}
	var groups []statsGroup
	total := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
		case strings.HasPrefix(line, "## "):
			name, rest := splitStatsGroup(strings.TrimSpace(line[3:]))
			groups = append(groups, statsGroup{name: name, rest: rest, hasHeader: true})
		default:
			cells := dataCells(line)
			if len(cells) < 2 || len(cells) > 3 {
				return "", fmt.Errorf("%q: write label | value | detail", line)
			}
			if len(groups) == 0 {
				groups = append(groups, statsGroup{})
			}
			groups[len(groups)-1].rows = append(groups[len(groups)-1].rows, cells)
			total++
		}
	}
	if total == 0 {
		return "", fmt.Errorf("no label | value lines")
	}

	var b strings.Builder
	b.WriteString(`<figure class="stats">`)
	if attrs["title"] != "" || attrs["meta"] != "" {
		fmt.Fprintf(&b, `<figcaption><span>%s</span><span class="key">%s</span></figcaption>`, html.EscapeString(attrs["title"]), html.EscapeString(attrs["meta"]))
	}
	for _, g := range groups {
		if g.hasHeader {
			fmt.Fprintf(&b, `<p class="stats-group"><b>%s</b>%s</p>`, html.EscapeString(g.name), html.EscapeString(g.rest))
		}
		if len(g.rows) == 0 {
			continue
		}
		cols := kpiCols(len(g.rows))
		fmt.Fprintf(&b, `<dl class="kpi" style="--k:%d">`, cols)
		for i, cells := range g.rows {
			divClass := ""
			if i >= cols {
				divClass = ` class="r2"`
			}
			ddClass := ""
			if strings.HasPrefix(cells[1], "+") {
				ddClass = ` class="up"`
			}
			fmt.Fprintf(&b, `<div%s><dt>%s</dt><dd%s>%s</dd>`, divClass, html.EscapeString(cells[0]), ddClass, formatKPIValue(cells[1]))
			if len(cells) == 3 && cells[2] != "" {
				detail := kpiDetailNegSign.ReplaceAllString(cells[2], "${1}−${2}")
				fmt.Fprintf(&b, `<dd class="s">%s</dd>`, html.EscapeString(detail))
			}
			b.WriteString("</div>")
		}
		b.WriteString("</dl>")
	}
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="data-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}

// A paragraph "::tv EXCHANGE:SYMBOL description interval=W height=480", or
// just "$BTC", becomes a TradingView card. The live chart loads only when the
// reader asks for it, so the page itself stays script-free until then.
type tickerExtension struct{ button string }

var kindTicker = ast.NewNodeKind("Ticker")

type tickerBlock struct {
	ast.BaseBlock
	Raw string
}

func (n *tickerBlock) Kind() ast.NodeKind            { return kindTicker }
func (n *tickerBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }

type tickerTransformer struct{}
type tickerRenderer struct{ button string }

var (
	shortTicker = regexp.MustCompile(`^\$([A-Z][A-Z0-9._]{0,15}|[A-Z0-9._-]+:[A-Z0-9._-]+)$`)
	// Bare crypto symbols mean their Binance USDT pair, as on the old blog.
	cryptoSymbols = strings.Fields("BTC ETH SOL BNB XRP DOGE ADA TRX TON AVAX LINK DOT LTC BCH SUI APT ARB OP NEAR ATOM UNI AAVE PEPE SHIB FIL ETC INJ TIA SEI WLD ENA")
)

func tickerSymbol(s string) string {
	if !strings.Contains(s, ":") && slices.Contains(cryptoSymbols, s) {
		return "BINANCE:" + s + "USDT"
	}
	return s
}

func (e tickerExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(tickerTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(tickerRenderer{e.button}, 100)))
}

func (tickerTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var found []*ast.Paragraph
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if p, ok := n.(*ast.Paragraph); entering && ok && p.Lines().Len() == 1 {
			if text := strings.TrimSpace(paragraphText(p, reader.Source())); text == "::tv" || strings.HasPrefix(text, "::tv ") || shortTicker.MatchString(text) {
				found = append(found, p)
			}
		}
		return ast.WalkContinue, nil
	})
	for _, p := range found {
		p.Parent().ReplaceChild(p.Parent(), p, &tickerBlock{Raw: strings.TrimSpace(paragraphText(p, reader.Source()))})
	}
}

func parseTicker(text string) (symbol, label, interval, height string, err error) {
	if m := shortTicker.FindStringSubmatch(text); m != nil {
		return tickerSymbol(m[1]), "", "", "", nil
	}
	var words []string
	for _, word := range strings.Fields(strings.TrimPrefix(text, "::tv")) {
		key, value, hasEq := strings.Cut(word, "=")
		switch {
		case !hasEq:
			words = append(words, word)
		case key == "interval" && value != "":
			interval = value
		case key == "height":
			h, err := strconv.Atoi(value)
			if err != nil || h <= 0 {
				return "", "", "", "", fmt.Errorf("height %q must be a positive integer", value)
			}
			height = value
		default:
			return "", "", "", "", fmt.Errorf("invalid option %q (use interval=…, height=…)", word)
		}
	}
	if len(words) == 0 {
		return "", "", "", "", fmt.Errorf("missing symbol")
	}
	return tickerSymbol(words[0]), strings.Join(words[1:], " "), interval, height, nil
}

func paragraphText(p *ast.Paragraph, source []byte) string {
	line := p.Lines().At(0)
	return string(line.Value(source))
}

func (tr tickerRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindTicker, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		t := n.(*tickerBlock)
		symbol, labelText, interval, height, err := parseTicker(t.Raw)
		if err != nil {
			return ast.WalkStop, fmt.Errorf("ticker %q: %w", t.Raw, err)
		}
		path := strings.ReplaceAll(symbol, ":", "-")
		label := ""
		if labelText != "" {
			label = `<span class="ticker-label">` + html.EscapeString(labelText) + `</span>`
		}
		_, err = fmt.Fprintf(w, `<div class="ticker" data-symbol="%s" data-interval="%s" data-height="%s"><span><b>%s</b>%s</span><span class="ticker-go"><button type="button">%s</button><a href="https://www.tradingview.com/symbols/%s/">TradingView ↗</a></span></div>`+"\n",
			html.EscapeString(symbol), html.EscapeString(interval), html.EscapeString(height), html.EscapeString(symbol), label, html.EscapeString(tr.button), url.PathEscape(path))
		return ast.WalkSkipChildren, err
	})
}
