package main

import (
	"fmt"
	"html"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// A ```data fence is a captioned table whose chosen columns carry thin
// inline bars. ```chart and ```stats fences share the same table syntax.
type dataExtension struct{ listSep string }

var (
	kindData          = ast.NewNodeKind("Data")
	dataAttribute     = regexp.MustCompile(`^(\w+)="([^"]*)"`)
	dataNumber        = regexp.MustCompile(`[-+−]?\d[\d,]*(?:\.\d+)?`)
	dataNumericHead   = regexp.MustCompile(`^[\s$€¥£~≈<>≤≥+-−±]*\d`)
	dataLeadingHyphen = regexp.MustCompile(`^([\s$€¥£~≈<>≤≥]*)-(\d)`)
	dataTrailingPar   = regexp.MustCompile(`\s*(?:\([^()]*\)|（[^（）]*）)\s*$`)
	dataISODate       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	dataMonoKey       = regexp.MustCompile(`^[Δ+-−~]?\d[\d.,/%a-zA-Z-]*$`)
	dataSeparator     = regexp.MustCompile(`^[\s|:-]+$`)
	dataAttributes    = []string{"title", "note", "bars", "scale", "mark"}
)

type dataBlock struct {
	ast.BaseBlock
	Lang, Info string
}

var dataRenderers = map[string]func(info string, lines []string) (string, error){
	"data":  renderData,
	"chart": func(info string, lines []string) (string, error) { return renderChart(info, lines, "、") },
	"stats": renderStats,
	"trace": renderTrace,
}

type dataTransformer struct{}
type dataRenderer struct{ listSep string }

func (n *dataBlock) Kind() ast.NodeKind            { return kindData }
func (n *dataBlock) Dump(source []byte, level int) { ast.DumpHelper(n, source, level, nil, nil) }
func (n *dataBlock) IsRaw() bool                   { return true }

func (e dataExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(parser.WithASTTransformers(util.Prioritized(dataTransformer{}, 100)))
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(dataRenderer{e.listSep}, 100)))
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

// gfmFirstColMono reports whether every non-empty body cell in column 0 of a
// GFM table is a short numeric/code token (such as "0.05" or "Δ0.35").
func gfmFirstColMono(tbl *ast.Node, source []byte) bool {
	rows := 0
	for r := (*tbl).FirstChild(); r != nil; r = r.NextSibling() {
		if _, isHeader := r.(*extast.TableHeader); isHeader {
			continue
		}
		c := r.FirstChild()
		if c == nil {
			continue
		}
		txt := strings.TrimSpace(plainText(c, source))
		if txt == "" {
			continue
		}
		rows++
		if !dataMonoKey.MatchString(txt) || cellCharWidth(txt) > 10 {
			return false
		}
	}
	return rows > 0
}

func (dr dataRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
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
		var (
			table string
			err   error
		)
		if block.Lang == "chart" {
			table, err = renderChart(block.Info, lines, dr.listSep)
		} else {
			table, err = dataRenderers[block.Lang](block.Info, lines)
		}
		if err != nil {
			return ast.WalkStop, fmt.Errorf("%s block %q: %w", block.Lang, block.Info, err)
		}
		_, err = w.WriteString(table)
		return ast.WalkSkipChildren, err
	})
	// Wrap standard GFM tables in a scrollable container so <table> keeps
	// display:table and spans 100% width, while right-aligned columns get .num.
	r.Register(extast.KindTable, func(w util.BufWriter, _ []byte, _ ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			_, err := w.WriteString("<div class=\"table-scroll\" tabindex=\"0\"><table>\n")
			return ast.WalkContinue, err
		}
		_, err := w.WriteString("</table></div>\n")
		return ast.WalkContinue, err
	})
	r.Register(extast.KindTableCell, func(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		tag := "td"
		_, isHeader := n.Parent().(*extast.TableHeader)
		if isHeader {
			tag = "th"
		}
		if !entering {
			_, err := w.WriteString("</" + tag + ">\n")
			return ast.WalkContinue, err
		}
		isFirst := n.PreviousSibling() == nil
		tbl := n.Parent().Parent()
		switch n.(*extast.TableCell).Alignment {
		case extast.AlignRight:
			_, err := fmt.Fprintf(w, `<%s class="num" style="text-align:right">`, tag)
			return ast.WalkContinue, err
		case extast.AlignCenter:
			_, err := fmt.Fprintf(w, `<%s style="text-align:center">`, tag)
			return ast.WalkContinue, err
		case extast.AlignLeft:
			if !isHeader && isFirst && tbl != nil && gfmFirstColMono(&tbl, source) {
				_, err := fmt.Fprintf(w, `<%s class="mono-key" style="text-align:left">`, tag)
				return ast.WalkContinue, err
			}
			_, err := fmt.Fprintf(w, `<%s style="text-align:left">`, tag)
			return ast.WalkContinue, err
		default:
			if !isHeader && isFirst && tbl != nil && gfmFirstColMono(&tbl, source) {
				_, err := fmt.Fprintf(w, `<%s class="mono-key">`, tag)
				return ast.WalkContinue, err
			}
			_, err := w.WriteString("<" + tag + ">")
			return ast.WalkContinue, err
		}
	})
}

func dataCells(line string) []string {
	line = strings.TrimSpace(line)
	if len(line) >= 2 && strings.HasPrefix(line, "|") && strings.HasSuffix(line, "|") && !strings.HasSuffix(line, `\|`) {
		line = line[1 : len(line)-1]
	}
	var cells []string
	start := 0
	inMath := false
	for i := 0; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) {
			i++
			continue
		}
		if line[i] == '$' {
			inMath = !inMath
			continue
		}
		if line[i] == '|' && !inMath {
			cells = append(cells, unescapeOutsideMath(strings.TrimSpace(line[start:i])))
			start = i + 1
		}
	}
	cells = append(cells, unescapeOutsideMath(strings.TrimSpace(line[start:])))
	return cells
}

func unescapeOutsideMath(cell string) string {
	if !strings.Contains(cell, `\|`) {
		return cell
	}
	var b strings.Builder
	inMath := false
	for i := 0; i < len(cell); i++ {
		if cell[i] == '\\' && i+1 < len(cell) {
			if cell[i+1] == '|' && !inMath {
				b.WriteByte('|')
			} else {
				b.WriteByte('\\')
				b.WriteByte(cell[i+1])
			}
			i++
			continue
		}
		if cell[i] == '$' {
			inMath = !inMath
		}
		b.WriteByte(cell[i])
	}
	return b.String()
}

func dataValue(cell string) (float64, bool) {
	match := dataNumber.FindString(cell)
	if match == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(strings.NewReplacer("−", "-", ",", "").Replace(match), 64)
	return value, err == nil
}

func isNullCell(cell string) bool {
	return cell == "—" || cell == "-" || cell == "–"
}

// formatNumericDisplay upgrades leading ASCII hyphen-minus on negative numbers
// (such as "-0.31" or "-10.23%") to true typographic minus "−" (U+2212).
func formatNumericDisplay(cell string) string {
	return dataLeadingHyphen.ReplaceAllString(cell, "${1}−${2}")
}

// dataIsNumericCell reports whether cell is a numeric measurement (possibly
// with currency, sign, unit, or a short parenthetical note) rather than prose
// that happens to mention a number (such as "2 家 7 人混编公司" or "全为负，38 国显著").
func dataIsNumericCell(cell string) bool {
	if dataISODate.MatchString(cell) {
		return false
	}
	if strings.Count(cell, "$") >= 2 {
		if rendered, err := inlineMathHTML(cell); err != nil || strings.Contains(rendered, "math-inline") {
			return false
		}
	}
	if _, ok := dataValue(cell); !ok {
		return false
	}
	core := dataTrailingPar.ReplaceAllString(cell, "")
	if !dataNumericHead.MatchString(core) {
		return false
	}
	letters, cjk := 0, 0
	for _, r := range core {
		switch {
		case r <= unicode.MaxASCII && unicode.IsLetter(r):
			letters++
		case unicode.Is(unicode.Han, r):
			cjk++
		}
	}
	return letters <= 8 && cjk <= 2
}

var texCommand = regexp.MustCompile(`\\[a-zA-Z]+|[${}^_]`)

// cellCharWidth estimates cell's monospace width in ch units so values in a bar
// column share one fixed width and their bar tracks line up vertically.
func cellCharWidth(cell string) int {
	if strings.Count(cell, "$") >= 2 {
		cell = texCommand.ReplaceAllString(cell, "")
	}
	w := 0
	for _, r := range cell {
		if r > unicode.MaxASCII && (unicode.Is(unicode.Han, r) || unicode.In(r, unicode.Hangul, unicode.Hiragana, unicode.Katakana) || strings.ContainsRune("（），。；：", r)) {
			w += 2
		} else {
			w++
		}
	}
	return max(w, 3)
}

// blockAttributes reads key="value" pairs after an optional leading fence
// language; allowed lists the keys a block accepts.
func blockAttributes(info string, allowed []string) (map[string]string, error) {
	attrs := map[string]string{}
	rest := strings.TrimSpace(info)
	if i := strings.IndexFunc(rest, unicode.IsSpace); i >= 0 && !strings.ContainsAny(rest[:i], `="'`) {
		rest = strings.TrimSpace(rest[i:])
	} else if i < 0 && !strings.ContainsAny(rest, `="'`) {
		rest = ""
	}
	for rest != "" {
		m := dataAttribute.FindStringSubmatch(rest)
		if m == nil {
			return nil, fmt.Errorf(`invalid attribute %q (write key="value")`, rest)
		}
		rest = rest[len(m[0]):]
		if rest != "" && !unicode.IsSpace(rune(rest[0])) {
			return nil, fmt.Errorf(`invalid attribute %q (separate key="value" pairs with spaces)`, m[0]+rest)
		}
		rest = strings.TrimSpace(rest)
		if !slices.Contains(allowed, m[1]) {
			return nil, fmt.Errorf("unknown attribute %q (use %s)", m[1], strings.Join(allowed, ", "))
		}
		if _, dup := attrs[m[1]]; dup {
			return nil, fmt.Errorf("duplicate attribute %q", m[1])
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
	isoDate := make([]bool, len(header))
	valWidth := make([]int, len(header))
	subWidth := make([]int, len(header))
	maxWidth := make([]int, len(header))
	firstColMono := true
	for col := range header {
		numeric[col] = col > 0
		isoDate[col] = col > 0
		hasDate := false
		for _, row := range rows[1:] {
			cell := row[col]
			disp := formatNumericDisplay(cell)
			maxWidth[col] = max(maxWidth[col], cellCharWidth(disp))
			if col == 0 && cell != "" && (!dataMonoKey.MatchString(cell) || cellCharWidth(cell) > 10) {
				firstColMono = false
			}
			if bars[col] {
				valWidth[col] = max(valWidth[col], cellCharWidth(disp))
			}
			if col > 0 && cell != "" && !isNullCell(cell) {
				if dataISODate.MatchString(cell) {
					hasDate = true
				} else {
					isoDate[col] = false
				}
				if !bars[col] && !dataIsNumericCell(cell) {
					numeric[col] = false
				}
			}
			if value, ok := dataValue(cell); ok && bars[col] {
				low[group(col)] = math.Min(low[group(col)], value)
				high[group(col)] = math.Max(high[group(col)], value)
			}
		}
		if !hasDate {
			isoDate[col] = false
		}
		if numeric[col] && !bars[col] {
			for _, row := range rows[1:] {
				if m := strings.TrimSpace(dataTrailingPar.FindString(row[col])); m != "" {
					subWidth[col] = max(subWidth[col], cellCharWidth(m))
				}
			}
		}
	}
	marks := map[string]bool{}
	if attrs["mark"] != "" {
		for _, name := range strings.Split(attrs["mark"], ",") {
			name = strings.TrimSpace(name)
			if name == "" || !slices.ContainsFunc(rows[1:], func(row []string) bool { return row[0] == name }) {
				return "", fmt.Errorf("mark %q is not a row label", name)
			}
			marks[name] = true
		}
	}
	figClasses := []string{"data"}
	switch {
	case len(header) == 2:
		figClasses = append(figClasses, "pair")
		if !numeric[1] && !bars[1] {
			figClasses = append(figClasses, "prose-pair")
		}
	case len(header) >= 7:
		figClasses = append(figClasses, "wide", "dense")
	case len(header) >= 5:
		figClasses = append(figClasses, "wide")
	}
	allTrailingNum := len(header) >= 2 && len(header) <= 4
	for col := 1; col < len(header); col++ {
		if !numeric[col] || bars[col] {
			allTrailingNum = false
		}
	}
	if allTrailingNum {
		figClasses = append(figClasses, "compact")
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<figure class="%s">`, strings.Join(figClasses, " "))
	if attrs["title"] != "" {
		titleHTML, err := inlineMathHTML(attrs["title"])
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "<figcaption>%s</figcaption>", titleHTML)
	}
	b.WriteString(`<div class="data-scroll" tabindex="0"><table><thead><tr>`)
	for col, cell := range header {
		cellHTML, err := inlineMathHTML(cell)
		if err != nil {
			return "", err
		}
		lo, hi := low[group(col)], high[group(col)]
		switch {
		case bars[col] && hi > lo && lo >= 0:
			fmt.Fprintf(&b, `<th class="num bar-head" style="--vw:%dch"><span class="bar-head-in">%s</span></th>`, valWidth[col], cellHTML)
		case numeric[col] && col > 0:
			b.WriteString(`<th class="num">` + cellHTML + "</th>")
		default:
			b.WriteString("<th>" + cellHTML + "</th>")
		}
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
			if col == 0 {
				class = append(class, "row-key")
				if firstColMono {
					class = append(class, "mono-key")
				}
			}
			if isoDate[col] {
				class = append(class, "date")
			}
			if !numeric[col] && !isoDate[col] && maxWidth[col] >= 12 {
				class = append(class, "prose-col")
			}
			if numeric[col] && col > 0 {
				class = append(class, "num")
			}
			lo, hi := low[group(col)], high[group(col)]
			disp := formatNumericDisplay(cell)
			if value, ok := dataValue(cell); ok && bars[col] && hi > lo {
				start, end := (math.Min(0, value)-lo)/(hi-lo)*100, (math.Max(0, value)-lo)/(hi-lo)*100
				class = append(class, "bar")
				if value < 0 {
					class = append(class, "neg")
				}
				trackClass := "bar-track"
				trackStyle := ""
				switch {
				case lo < 0 && hi > 0:
					trackClass += " zero"
					trackStyle = fmt.Sprintf(` style="--z:%.1f%%"`, -lo/(hi-lo)*100)
				case lo < 0:
					trackClass += " zero-end"
				}
				fmt.Fprintf(&b, `<td class="%s" style="--vw:%dch"><span class="bar-cell"><span class="%s"%s aria-hidden="true"><i class="bar-fill" style="left:%.1f%%;width:%.1f%%"></i></span><span class="bar-val">%s</span></span></td>`,
					strings.Join(class, " "), valWidth[col], trackClass, trackStyle, start, end-start, html.EscapeString(disp))
				continue
			}
			if bars[col] && valWidth[col] > 0 {
				if isNullCell(cell) {
					class = append(class, "null")
					disp = "—"
				}
				fmt.Fprintf(&b, `<td class="%s" style="--vw:%dch"><span class="bar-cell"><span class="bar-val">%s</span></span></td>`,
					strings.Join(class, " "), valWidth[col], html.EscapeString(disp))
				continue
			}
			if numeric[col] && col > 0 && isNullCell(cell) {
				class = append(class, "null")
				fmt.Fprintf(&b, `<td class="%s">—</td>`, strings.Join(class, " "))
				continue
			}
			if subWidth[col] > 0 && cell != "" {
				sub := strings.TrimSpace(dataTrailingPar.FindString(cell))
				main := formatNumericDisplay(strings.TrimSpace(dataTrailingPar.ReplaceAllString(cell, "")))
				class = append(class, "has-sub")
				fmt.Fprintf(&b, `<td class="%s"><span class="num-main">%s</span><span class="num-sub">%s</span></td>`,
					strings.Join(class, " "), html.EscapeString(main), html.EscapeString(sub))
				continue
			}
			cellOut := cell
			if numeric[col] && col > 0 {
				cellOut = disp
			}
			cellHTML, err := inlineMathHTML(cellOut)
			if err != nil {
				return "", err
			}
			if len(class) > 0 {
				fmt.Fprintf(&b, `<td class="%s">`, strings.Join(class, " "))
			} else {
				b.WriteString("<td>")
			}
			b.WriteString(cellHTML + "</td>")
		}
		b.WriteString("</tr>")
	}
	b.WriteString("</tbody></table></div>")
	if attrs["note"] != "" {
		noteHTML, err := inlineMathHTML(attrs["note"])
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, `<p class="data-note">%s</p>`, noteHTML)
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
