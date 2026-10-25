package main

import (
	"fmt"
	"html"
	"math"
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

// A ```data fence is a captioned table whose chosen columns carry thin
// inline bars. ```chart and ```stats fences share the same table syntax.
type dataExtension struct{}

var (
	kindData       = ast.NewNodeKind("Data")
	dataAttribute  = regexp.MustCompile(`(\w+)="([^"]*)"`)
	dataNumber     = regexp.MustCompile(`[-+−]?\d[\d,]*(?:\.\d+)?`)
	dataSeparator  = regexp.MustCompile(`^[\s|:-]+$`)
	dataAttributes = []string{"title", "note", "bars", "scale", "mark"}
)

type dataBlock struct {
	ast.BaseBlock
	Lang, Info string
}

var dataRenderers = map[string]func(info string, lines []string) (string, error){
	"data":  renderData,
	"chart": renderChart,
	"stats": renderStats,
}

type dataTransformer struct{}
type dataRenderer struct{}

func (n *dataBlock) Kind() ast.NodeKind            { return kindData }
func (n *dataBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }
func (n *dataBlock) IsRaw() bool                   { return true }

func (dataExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(dataTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(dataRenderer{}, 100)))
}

func (dataTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	var fences []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fence, ok := n.(*ast.FencedCodeBlock); entering && ok && dataRenderers[string(fence.Language(reader.Source()))] != nil {
			fences = append(fences, fence)
		}
		return ast.WalkContinue, nil
	})
	for _, fence := range fences {
		block := &dataBlock{Lang: string(fence.Language(reader.Source())), Info: string(fence.Info.Segment.Value(reader.Source()))}
		block.SetLines(fence.Lines())
		fence.Parent().ReplaceChild(fence.Parent(), fence, block)
	}
}

func (dataRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindData, func(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var lines []string
		for i := 0; i < n.Lines().Len(); i++ {
			line := n.Lines().At(i)
			lines = append(lines, string(line.Value(source)))
		}
		block := n.(*dataBlock)
		table, err := dataRenderers[block.Lang](block.Info, lines)
		if err != nil {
			return ast.WalkStop, fmt.Errorf("%s block %q: %w", block.Lang, block.Info, err)
		}
		_, err = w.WriteString(table)
		return ast.WalkSkipChildren, err
	})
}

func dataCells(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimSuffix(strings.TrimPrefix(line, "|"), "|")
	cells := strings.Split(line, "|")
	for i := range cells {
		cells[i] = strings.TrimSpace(cells[i])
	}
	return cells
}

func dataValue(cell string) (float64, bool) {
	match := dataNumber.FindString(cell)
	if match == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.NewReplacer("−", "-", ",", "").Replace(match), 64)
	return value, err == nil
}

// blockAttributes reads key="value" pairs; allowed lists the keys a block accepts.
func blockAttributes(info string, allowed []string) (map[string]string, error) {
	attrs := map[string]string{}
	for _, m := range dataAttribute.FindAllStringSubmatch(info, -1) {
		if !slices.Contains(allowed, m[1]) {
			return nil, fmt.Errorf("unknown attribute %q (use %s)", m[1], strings.Join(allowed, ", "))
		}
		attrs[m[1]] = m[2]
	}
	return attrs, nil
}

// blockRows splits pipe rows, skipping blank and separator lines, and checks they align with the header.
func blockRows(lines []string) ([][]string, error) {
	var rows [][]string
	for _, line := range lines {
		if strings.TrimSpace(line) != "" && !dataSeparator.MatchString(line) {
			rows = append(rows, dataCells(line))
		}
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("need a header row and at least one data row")
	}
	for i, row := range rows {
		if len(row) != len(rows[0]) {
			return nil, fmt.Errorf("row %d has %d cells, header has %d", i+1, len(row), len(rows[0]))
		}
	}
	return rows, nil
}

func renderData(info string, lines []string) (string, error) {
	attrs, err := blockAttributes(info, dataAttributes)
	if err != nil {
		return "", err
	}
	if scale := attrs["scale"]; scale != "" && scale != "shared" && scale != "column" {
		return "", fmt.Errorf(`scale must be "shared" or "column"`)
	}
	rows, err := blockRows(lines)
	if err != nil {
		return "", err
	}
	header := rows[0]
	bars := make([]bool, len(header))
	if attrs["bars"] != "" {
		for _, name := range strings.Split(attrs["bars"], ",") {
			i := slices.Index(header, strings.TrimSpace(name))
			if i < 0 {
				return "", fmt.Errorf("bars column %q is not in the header", name)
			}
			bars[i] = true
		}
	}
	// Columns share one scale unless they measure different units.
	group := func(col int) int {
		if attrs["scale"] == "column" {
			return col
		}
		return -1
	}
	low, high := map[int]float64{}, map[int]float64{}
	numeric := make([]bool, len(header))
	for col := range header {
		numeric[col] = true
		for _, row := range rows[1:] {
			value, ok := dataValue(row[col])
			if row[col] != "" && row[col] != "—" && row[col] != "-" && !ok {
				numeric[col] = false
			}
			if ok && bars[col] {
				low[group(col)] = math.Min(low[group(col)], value)
				high[group(col)] = math.Max(high[group(col)], value)
			}
		}
	}
	marks := map[string]bool{}
	if attrs["mark"] != "" {
		for _, name := range strings.Split(attrs["mark"], ",") {
			marks[strings.TrimSpace(name)] = true
		}
	}
	var b strings.Builder
	b.WriteString(`<figure class="data">`)
	if attrs["title"] != "" {
		fmt.Fprintf(&b, "<figcaption>%s</figcaption>", html.EscapeString(attrs["title"]))
	}
	b.WriteString(`<div class="data-scroll" tabindex="0"><table><thead><tr>`)
	for col, cell := range header {
		if numeric[col] && col > 0 {
			b.WriteString(`<th class="num">`)
		} else {
			b.WriteString("<th>")
		}
		b.WriteString(html.EscapeString(cell) + "</th>")
	}
	b.WriteString("</tr></thead><tbody>")
	for _, row := range rows[1:] {
		if marks[row[0]] {
			b.WriteString(`<tr class="mark">`)
		} else {
			b.WriteString("<tr>")
		}
		for col, cell := range row {
			var class []string
			style := ""
			if numeric[col] && col > 0 {
				class = append(class, "num")
			}
			lo, hi := low[group(col)], high[group(col)]
			if value, ok := dataValue(cell); ok && bars[col] && hi > lo {
				// Bars grow from zero; mixed signs put zero inside the cell.
				start, end := (math.Min(0, value)-lo)/(hi-lo)*100, (math.Max(0, value)-lo)/(hi-lo)*100
				class = append(class, "bar")
				if value < 0 {
					class = append(class, "neg")
				}
				style = fmt.Sprintf(` style="--a:%.1f%%;--b:%.1f%%`, start, end)
				if lo < 0 {
					style += fmt.Sprintf(";--z:%.1f%%", -lo/(hi-lo)*100)
				}
				style += `"`
			}
			if len(class) > 0 {
				fmt.Fprintf(&b, `<td class="%s"%s>`, strings.Join(class, " "), style)
			} else {
				b.WriteString("<td>")
			}
			b.WriteString(html.EscapeString(cell) + "</td>")
		}
		b.WriteString("</tr>")
	}
	b.WriteString("</tbody></table></div>")
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="data-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
