package main

import (
	"fmt"
	"html"
	"math"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A ```chart fence is drawn as static SVG at build time. The first column is
// x (dates, numbers or categories), every other column is a series:
//
//	```chart line title="…" note="…"
//	date | BTC | ETH
//	2022-09-02 | -0.001 | -0.006
//
// Types: line, area, bar, scatter (label | x | y). Flags: panels="true" gives
// each series its own panel, mirror="true" hangs the second bar series below
// the axis, diag="true" adds y = x to a scatter. ref lists vertical reference
// x values, mark names scatter points to label, xfmt/yfmt are printf formats
// and xscale multiplies x before xfmt. Text is HTML laid over the SVG so it
// stays readable when the chart shrinks.
var (
	chartAttributes = []string{"title", "note", "panels", "mirror", "diag", "ref", "mark", "xfmt", "xscale", "yfmt"}
	chartType       = regexp.MustCompile(`^chart\s+(\w+)`)
	chartPalette    = []string{"#486043", "#8a4f2a", "#a3a79a"}
)

const (
	chartW     = 664.0
	chartLeft  = 52.0
	chartTop   = 10.0
	chartFoot  = 24.0
	chartGap   = 30.0
	chartRed   = "#b4553f"
	chartGrid  = "#ebece5"
	chartZero  = "#9ba393"
	chartMuted = "#686d64"
	chartInk   = "#292c28"
)

type chartSeries struct {
	name string
	text []string
	vals []float64
	ok   []bool
}

type chartAxis struct{ lo, hi, step float64 }

func niceAxis(lo, hi float64, target int) chartAxis {
	if lo == hi {
		lo, hi = lo-1, hi+1
	}
	raw := (hi - lo) / float64(target)
	mag := math.Pow(10, math.Floor(math.Log10(raw)))
	step := 10 * mag
	for _, m := range []float64{1, 2, 2.5, 5, 10} {
		if m*mag >= raw*0.999 {
			step = m * mag
			break
		}
	}
	return chartAxis{math.Floor(lo/step+1e-9) * step, math.Ceil(hi/step-1e-9) * step, step}
}

func (a chartAxis) ticks() []float64 {
	var out []float64
	for i := 0; ; i++ {
		v := a.lo + float64(i)*a.step
		if v > a.hi+a.step/2 {
			return out
		}
		if math.Abs(v) < a.step*1e-9 {
			v = 0
		}
		out = append(out, v)
	}
}

// chartNumber formats a tick: printf when given, else the step's decimals,
// thousands separators, "+" on signed axes and a true minus sign.
func chartNumber(v, step float64, signed bool, format string) string {
	if math.Abs(v) < math.Abs(step)*1e-6 {
		v = 0
	}
	var s string
	if format != "" {
		s = fmt.Sprintf(format, v)
	} else {
		d := 0
		for d < 6 && math.Abs(step*math.Pow(10, float64(d))-math.Round(step*math.Pow(10, float64(d)))) > 1e-6 {
			d++
		}
		s = strconv.FormatFloat(math.Abs(v), 'f', d, 64)
		if math.Abs(v) >= 10000 {
			whole, frac, _ := strings.Cut(s, ".")
			for i := len(whole) - 3; i > 0; i -= 3 {
				whole = whole[:i] + "," + whole[i:]
			}
			s = whole
			if frac != "" {
				s += "." + frac
			}
		}
		if v < 0 {
			s = "-" + s
		} else if signed && v > 0 {
			s = "+" + s
		}
	}
	return strings.ReplaceAll(s, "-", "−")
}

func chartPct(v, total float64) string { return strconv.FormatFloat(v/total*100, 'f', 3, 64) + "%" }

type chartCanvas struct {
	h      float64
	svg    strings.Builder
	labels strings.Builder
}

func (c *chartCanvas) path(d, attrs string) {
	if d != "" {
		fmt.Fprintf(&c.svg, `<path d="%s" %s vector-effect="non-scaling-stroke"/>`, d, attrs)
	}
}

// label places text at an SVG point; class picks the anchor (yl, xl, dl).
func (c *chartCanvas) label(class string, x, y float64, text, style string) {
	fmt.Fprintf(&c.labels, `<span class="%s" style="left:%s;top:%s%s">%s</span>`, class, chartPct(x, chartW), chartPct(y, c.h), style, html.EscapeString(text))
}

type chartPanel struct {
	top, bottom float64
	axis        chartAxis
}

func (p chartPanel) y(v float64) float64 {
	return p.bottom - (v-p.axis.lo)/(p.axis.hi-p.axis.lo)*(p.bottom-p.top)
}

// f1 rounds SVG coordinates to a tenth and drops a trailing ".0".
func f1(v float64) string {
	return strings.TrimSuffix(strconv.FormatFloat(math.Round(v*10)/10, 'f', 1, 64), ".0")
}

func renderChart(info string, lines []string) (string, error) {
	kind := ""
	if m := chartType.FindStringSubmatch(info); m != nil {
		kind = m[1]
	}
	if !slices.Contains([]string{"line", "area", "bar", "scatter"}, kind) {
		return "", fmt.Errorf("start with a chart type: line, area, bar or scatter")
	}
	attrs, err := blockAttributes(info, chartAttributes)
	if err != nil {
		return "", err
	}
	rows, err := blockRows(lines)
	if err != nil {
		return "", err
	}
	header, rows := rows[0], rows[1:]
	if len(header) < 2 || (kind == "scatter" && len(header) != 3) {
		return "", fmt.Errorf("need an x column and at least one series (scatter: label | x | y)")
	}
	panels, mirror := attrs["panels"] == "true", attrs["mirror"] == "true"
	if mirror && (kind != "bar" || len(header) != 3) {
		return "", fmt.Errorf("mirror needs a bar chart with exactly two series")
	}
	xText := make([]string, len(rows))
	for i, row := range rows {
		xText[i] = row[0]
	}
	first := 1
	if kind == "scatter" {
		first = 2
	}
	var series []chartSeries
	for col := first; col < len(header); col++ {
		s := chartSeries{name: header[col]}
		for _, row := range rows {
			v, ok := dataValue(row[col])
			s.text, s.vals, s.ok = append(s.text, row[col]), append(s.vals, v), append(s.ok, ok)
		}
		series = append(series, s)
	}

	// x positions in data units: days for dates, values for numbers, else the row index.
	xs := make([]float64, len(rows))
	xKind := "date"
	for i, t := range xText {
		d, err := time.Parse("2006-01-02", t)
		if err != nil {
			xKind = ""
			break
		}
		xs[i] = float64(d.Unix()) / 86400
	}
	if kind == "scatter" || xKind == "" {
		xKind = "number"
		for i, row := range rows {
			cell := row[0]
			if kind == "scatter" {
				cell = row[1]
			}
			v, err := strconv.ParseFloat(strings.TrimPrefix(strings.NewReplacer("−", "-", ",", "").Replace(cell), "+"), 64)
			if err != nil {
				if kind == "scatter" {
					return "", fmt.Errorf("scatter x %q is not a number", cell)
				}
				xKind = "category"
				break
			}
			xs[i] = v
		}
	}
	if kind == "bar" || xKind == "category" {
		for i := range xs {
			xs[i] = float64(i)
		}
	}

	right := 16.0
	endLabels := kind == "line" && xKind == "date" && !panels
	if endLabels || panels || mirror {
		right = 72
	}
	plotR := chartW - right
	xlo, xhi := slices.Min(xs), slices.Max(xs)
	var xAxis chartAxis
	if xKind == "number" && kind != "bar" {
		xAxis = niceAxis(xlo, xhi, 5)
		if kind == "line" || kind == "area" {
			xAxis.lo, xAxis.hi = xlo, xhi
		}
		xlo, xhi = xAxis.lo, xAxis.hi
	}
	band := 0.0
	if kind == "bar" {
		band = (plotR - chartLeft) / float64(len(rows))
	}
	xpx := func(v float64) float64 {
		if kind == "bar" {
			return chartLeft + band*(v+0.5)
		}
		if xhi == xlo {
			return (chartLeft + plotR) / 2
		}
		return chartLeft + (v-xlo)/(xhi-xlo)*(plotR-chartLeft)
	}

	// One panel per series, or one shared panel; mirror shares one magnitude scale.
	grouped := !panels && !mirror && len(series) > 1
	groups := [][]int{{}}
	for i := range series {
		if panels {
			groups = append(groups, []int{i})
		} else {
			groups[0] = append(groups[0], i)
		}
	}
	if panels {
		groups = groups[1:]
	}
	height := 240.0
	if kind == "scatter" {
		height = 290
	}
	if panels {
		height = 110
	}
	c := &chartCanvas{}
	var ps []chartPanel
	top := chartTop
	for _, g := range groups {
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, si := range g {
			for i, v := range series[si].vals {
				if series[si].ok[i] {
					if mirror {
						v = math.Abs(v)
					}
					lo, hi = math.Min(lo, v), math.Max(hi, v)
				}
			}
		}
		if kind == "scatter" && attrs["diag"] == "true" {
			lo, hi = math.Min(lo, xAxis.lo), math.Max(hi, xAxis.hi)
		}
		if kind != "line" && kind != "scatter" {
			lo, hi = math.Min(lo, 0), math.Max(hi, 0)
		}
		if math.IsInf(lo, 0) {
			return "", fmt.Errorf("no numeric values")
		}
		target := 5
		if panels {
			target = 3
		}
		axis := niceAxis(lo, hi, target)
		if mirror {
			axis = chartAxis{0, axis.hi, axis.step}
			half := height / 2
			ps = append(ps, chartPanel{top, top + half, axis}, chartPanel{top + half, top + 2*half, axis})
		} else {
			ps = append(ps, chartPanel{top, top + height, axis})
		}
		top += height + chartGap
	}
	c.h = top - chartGap + chartFoot
	if kind == "scatter" {
		c.h += 4
	}

	var grid, zero strings.Builder
	for pi, p := range ps {
		signed := p.axis.lo < 0
		for _, v := range p.axis.ticks() {
			if mirror && pi == 1 && v == 0 {
				continue
			}
			y := p.y(v)
			if mirror && pi == 1 {
				y = p.top + (p.top - ps[0].y(v))
			}
			if v == 0 && (kind != "line" || p.axis.lo < 0) {
				fmt.Fprintf(&zero, "M%s %sH%s", f1(chartLeft), f1(y), f1(plotR))
			} else {
				fmt.Fprintf(&grid, "M%s %sH%s", f1(chartLeft), f1(y), f1(plotR))
			}
			c.label("yl", 0, y, chartNumber(v, p.axis.step, signed, attrs["yfmt"]), ";width:"+chartPct(chartLeft-8, chartW))
		}
	}
	if kind == "scatter" {
		for _, v := range xAxis.ticks() {
			if v == 0 {
				fmt.Fprintf(&zero, "M%s %sV%s", f1(xpx(v)), f1(ps[0].top), f1(ps[0].bottom))
			} else {
				fmt.Fprintf(&grid, "M%s %sV%s", f1(xpx(v)), f1(ps[0].top), f1(ps[0].bottom))
			}
		}
	}
	c.path(grid.String(), `stroke="`+chartGrid+`" fill="none"`)

	// x ticks: years for dates, nice values for numbers, spaced categories otherwise.
	base := ps[len(ps)-1].bottom + 14
	type xTick struct {
		x    float64
		text string
	}
	var xTicks []xTick
	tick := func(_ int, x float64, text string) { xTicks = append(xTicks, xTick{x, text}) }
	xScale := 1.0
	if attrs["xscale"] != "" {
		if xScale, err = strconv.ParseFloat(attrs["xscale"], 64); err != nil {
			return "", fmt.Errorf("xscale must be a number")
		}
	}
	switch {
	case xKind == "date":
		n := 0
		for i := range xText {
			if i > 0 && xText[i][:4] != xText[i-1][:4] {
				x := xpx(xs[i])
				if kind != "bar" {
					jan, _ := time.Parse("2006-01-02", xText[i][:4]+"-01-01")
					x = xpx(float64(jan.Unix()) / 86400)
				}
				tick(n, x, xText[i][:4])
				n++
			}
		}
	case xKind == "number" && kind != "bar":
		ticks := niceAxis(xAxis.lo, xAxis.hi, 5)
		for n, v := range ticks.ticks() {
			if v >= xlo-1e-9 && v <= xhi+1e-9 {
				tick(n, xpx(v), chartNumber(v*xScale, ticks.step*xScale, kind == "scatter" && xlo < 0, attrs["xfmt"]))
			}
		}
	default:
		every := max(1, (len(xText)+5)/6)
		for i := every / 2; i < len(xText); i += every {
			tick(i/every, xpx(xs[i]), strings.ReplaceAll(xText[i], "-", "−"))
		}
	}

	// Phones show every other tick once there are more than four.
	for n, t := range xTicks {
		class := "xl"
		if n%2 == 1 && len(xTicks) > 4 {
			class = "xl alt"
		}
		c.label(class, t.x, base, t.text, "")
	}

	if attrs["ref"] != "" {
		var d strings.Builder
		for _, part := range strings.Split(attrs["ref"], ",") {
			v, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
			if err != nil {
				return "", fmt.Errorf("ref %q is not a number", part)
			}
			x := xpx(v)
			fmt.Fprintf(&d, "M%s %sV%s", f1(x), f1(ps[0].top), f1(ps[len(ps)-1].bottom))
			style := ";transform:translate(6px,0)"
			if x < (chartLeft+plotR)/2 {
				style = ";transform:translate(calc(-100% - 6px),0)"
			}
			c.label("dl", x, ps[0].top+2, chartNumber(v, 1, false, ""), style)
		}
		c.path(d.String(), `stroke="`+chartMuted+`" stroke-dasharray="2 3" fill="none"`)
	}

	// note places an annotation beside a point, flipping left near the right edge.
	// half is the mark's half width, so text clears a bar instead of covering it.
	note := func(x, y, half float64, text, color string) {
		style := ";transform:translate(6px,-50%);color:" + color
		if x > chartLeft+(plotR-chartLeft)*0.7 {
			x, style = x-half, ";transform:translate(calc(-100% - 6px),-50%);color:"+color
		} else {
			x += half
		}
		c.label("dl", x, y, text, style)
	}
	minus := strings.NewReplacer("-", "−")
	type end struct {
		y     float64
		text  string
		color string
	}
	var ends []end
	for gi, g := range groups {
		for k := len(g) - 1; k >= 0; k-- {
			si := g[k]
			s := series[si]
			color := chartPalette[si%len(chartPalette)]
			if panels && kind == "bar" {
				color = chartPalette[0]
			}
			p := ps[gi]
			switch kind {
			case "line", "area":
				var d strings.Builder
				pen := "M"
				var pts [][2]float64
				for i, v := range s.vals {
					if !s.ok[i] {
						pen = "M"
						continue
					}
					x, y := xpx(xs[i]), p.y(v)
					fmt.Fprintf(&d, "%s%s %s", pen, f1(x), f1(y))
					pen = "L"
					pts = append(pts, [2]float64{x, y})
				}
				width := "1.5"
				if si == 0 {
					width = "2"
				}
				if kind == "area" && len(pts) > 0 {
					c.path(fmt.Sprintf("%sL%s %sL%s %sZ", d.String(), f1(pts[len(pts)-1][0]), f1(p.y(0)), f1(pts[0][0]), f1(p.y(0))), `fill="`+color+`" fill-opacity="0.16"`)
					width = "1.25"
				}
				c.path(d.String(), `stroke="`+color+`" stroke-width="`+width+`" fill="none" stroke-linejoin="round"`)
				if endLabels {
					for i := len(s.vals) - 1; i >= 0; i-- {
						if s.ok[i] {
							ends = append(ends, end{p.y(s.vals[i]), s.name + " " + minus.Replace(s.text[i]), color})
							break
						}
					}
				}
			case "bar":
				var pos, neg strings.Builder
				w := band * 0.72
				if len(rows) <= 60 {
					w = band - 2
				}
				offset := 0.0
				if grouped {
					w = (band - 2) / float64(len(series))
					offset = (float64(si) - float64(len(series)-1)/2) * w
				}
				for i, v := range s.vals {
					if !s.ok[i] || v == 0 {
						continue
					}
					x0 := xpx(xs[i]) + offset - w/2
					y0, y1 := p.y(0), p.y(v)
					if mirror {
						y0, y1 = p.bottom, p.y(math.Abs(v))
						if si == 1 {
							y0, y1 = ps[1].top, ps[1].top+(ps[0].bottom-ps[0].y(math.Abs(v)))
						}
					}
					rect := fmt.Sprintf("M%s %sh%sV%sh%sZ", f1(x0), f1(math.Min(y0, y1)), f1(w), f1(math.Max(y0, y1)), f1(-w))
					if v < 0 && !mirror && !grouped {
						neg.WriteString(rect)
					} else {
						pos.WriteString(rect)
					}
				}
				opacity := ""
				if mirror && si == 1 {
					opacity = ` fill-opacity="0.85"`
				}
				c.path(pos.String(), `fill="`+color+`"`+opacity)
				c.path(neg.String(), `fill="`+chartRed+`"`)
			case "scatter":
				var dots, drops strings.Builder
				for i, v := range s.vals {
					if !s.ok[i] {
						continue
					}
					x, y := xpx(xs[i]), p.y(v)
					fmt.Fprintf(&dots, "M%s %sh0", f1(x), f1(y))
					if attrs["diag"] == "true" {
						fmt.Fprintf(&drops, "M%s %sV%s", f1(x), f1(p.y(xs[i])), f1(y))
					}
				}
				if attrs["diag"] == "true" {
					lo, hi := math.Max(xlo, p.axis.lo), math.Min(xhi, p.axis.hi)
					c.path(fmt.Sprintf("M%s %sL%s %s", f1(xpx(lo)), f1(p.y(lo)), f1(xpx(hi)), f1(p.y(hi))), `stroke="`+chartMuted+`" stroke-dasharray="3 3" fill="none"`)
					c.path(drops.String(), `stroke="`+chartRed+`" stroke-opacity="0.6" fill="none"`)
				}
				c.path(dots.String(), `stroke="#fff" stroke-width="12" stroke-linecap="round"`)
				c.path(dots.String(), `stroke="`+color+`" stroke-width="9" stroke-linecap="round"`)
			}
		}
	}
	c.path(zero.String(), `stroke="`+chartZero+`" fill="none"`)

	// Text over the marks: extremes, end values, panel names and marked points.
	for gi, g := range groups {
		for _, si := range g {
			s := series[si]
			if kind == "bar" || kind == "area" {
				// The extreme worth naming: the lowest value if any is negative, else the highest.
				best, negative := -1, false
				for i, v := range s.vals {
					negative = negative || s.ok[i] && v < 0 && !mirror
				}
				for i, v := range s.vals {
					if s.ok[i] && (best < 0 || negative && v < s.vals[best] || !negative && math.Abs(v) > math.Abs(s.vals[best])) {
						best = i
					}
				}
				if best >= 0 && !grouped {
					v := s.vals[best]
					p := ps[gi]
					y := p.y(v)
					color := chartInk
					if kind == "bar" && v < 0 {
						color = chartRed
					}
					if mirror {
						y = ps[0].y(math.Abs(v))
						if si == 1 {
							p = ps[1]
							y = ps[1].top + (ps[0].bottom - ps[0].y(math.Abs(v)))
						}
						color = chartPalette[si]
					}
					text := minus.Replace(s.text[best])
					if strings.HasSuffix(attrs["yfmt"], "%%") {
						text += "%"
					}
					if xKind == "category" {
						text += " · " + minus.Replace(xText[best])
					} else {
						text += " · " + xText[best]
					}
					note(xpx(xs[best]), y, band/2, text, color)
				}
			}
			if panels {
				c.label("dl tag", plotR+8, ps[gi].top+8, s.name, ";transform:translate(0,-50%);color:"+chartInk)
			}
		}
	}
	if mirror {
		c.label("dl tag", plotR+8, ps[0].top+12, series[0].name+" ↑", ";transform:translate(0,-50%);color:"+chartInk)
		c.label("dl tag", plotR+8, ps[1].bottom-12, series[1].name+" ↓", ";transform:translate(0,-50%);color:"+chartInk)
	}
	sort.Slice(ends, func(i, j int) bool { return ends[i].y < ends[j].y })
	for i := range ends {
		if i > 0 && ends[i].y-ends[i-1].y < 15 {
			ends[i].y = ends[i-1].y + 15
		}
	}
	for _, e := range ends {
		c.label("dl end", plotR+8, e.y, e.text, ";transform:translate(0,-50%);color:"+e.color)
	}
	if kind == "scatter" && attrs["mark"] != "" {
		for _, name := range strings.Split(attrs["mark"], ",") {
			i := slices.Index(xText, strings.TrimSpace(name))
			if i < 0 {
				return "", fmt.Errorf("mark %q is not a point label", name)
			}
			note(xpx(xs[i]), ps[0].y(series[0].vals[i]), 4.5, xText[i], chartInk)
		}
	}

	var b strings.Builder
	title := attrs["title"]
	b.WriteString(`<figure class="chart">`)
	if title != "" || len(series) > 1 && !panels {
		fmt.Fprintf(&b, "<figcaption><span>%s</span>", html.EscapeString(title))
		if len(series) > 1 && !panels {
			b.WriteString(`<span class="key">`)
			for i, s := range series {
				shape := ""
				if kind != "line" {
					shape = ` class="sq"`
				}
				fmt.Fprintf(&b, `<span><i%s style="background:%s"></i>%s</span>`, shape, chartPalette[i%len(chartPalette)], html.EscapeString(s.name))
			}
			b.WriteString(`</span>`)
		}
		b.WriteString("</figcaption>")
	}
	label := title
	if label == "" {
		label = strings.Join(header[first:], "、")
	}
	// The svg may stretch vertically on phones (see style.css); strokes keep their width.
	fmt.Fprintf(&b, `<div class="plot" style="--h:%s"><svg viewBox="0 0 %s %s" preserveAspectRatio="none" role="img" aria-label="%s">%s</svg>%s</div>`, f1(c.h), f1(chartW), f1(c.h), html.EscapeString(label), c.svg.String(), c.labels.String())
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="data-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
