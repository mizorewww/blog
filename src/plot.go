package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html"
	"slices"
	"strings"
)

// A ```plot figure is a set of panels drawn by Observable Plot
// (https://observablehq.com/plot/) in headless Chrome at build time, like
// ```echarts, but with nothing loaded on the page: scaling-law panels,
// log axes, small multiples, dot strips, bands and slopes stay static SVG.
// Each panel is drawn twice, at its width in the reading column and at its
// width on a phone, so tick labels keep their size instead of shrinking with
// the drawing. Data points with a tip carry it as data-t; templates/js/plot.js
// shows the one nearest the pointer.

// plotSpec is the fence's JSON body.
type plotSpec struct {
	Data   map[string]json.RawMessage   `json:"data"`
	Panels []map[string]json.RawMessage `json:"-"`
	Legend []plotLegend                 `json:"legend"`
	Cols   int                          `json:"cols"`
	Narrow int                          `json:"narrowCols"`
	XLabel string                       `json:"xlabel"`
	drawn  []plotPanel
}

type plotLegend struct {
	Label string `json:"label"`
	Color string `json:"color"`
	Shape string `json:"shape"` // dot, line, dash, ramp, band
}

// plotPanel is one panel ready to draw: its title and the Plot options sent
// to the drawing script at each of the two widths.
type plotPanel struct {
	title          string
	options        string // compact JSON: Plot.plot options with data inlined
	height, narrow int
	wide, phone    string // the drawn SVGs
}

var (
	// plotKeys are the spec's own keys; any other top-level key makes the
	// whole body one panel.
	plotKeys = []string{"data", "panels", "legend", "cols", "narrowCols", "xlabel"}
	// plotPanelKeys are the Plot.plot options a panel may set, plus its title
	// and heights. Plot's own title, caption, legends and style are left out:
	// the figure draws those itself, in the page's type.
	plotPanelKeys = []string{"title", "height", "narrowHeight", "marks",
		"x", "y", "fx", "fy", "color", "opacity", "r", "symbol", "length",
		"grid", "inset", "insetTop", "insetRight", "insetBottom", "insetLeft",
		"margin", "marginTop", "marginRight", "marginBottom", "marginLeft", "facet", "clip"}
	plotMarks = []string{"area", "areaX", "areaY", "arrow", "axisX", "axisY", "barX", "barY", "cell", "cellX", "cellY",
		"dot", "dotX", "dotY", "frame", "gridX", "gridY", "line", "lineX", "lineY", "link",
		"linearRegressionX", "linearRegressionY", "rect", "rectX", "rectY", "ruleX", "ruleY",
		"text", "textX", "textY", "tickX", "tickY", "vector", "waffleX", "waffleY", "boxX", "boxY", "density", "contour", "hexagon"}
	plotTransforms = []string{"dodgeX", "dodgeY", "normalizeX", "normalizeY", "windowX", "windowY", "binX", "binY", "bin",
		"groupX", "groupY", "group", "stackX", "stackY", "hexbin", "mapX", "mapY"}
	plotLegendShapes = []string{"dot", "line", "dash", "ramp", "band"}
)

// parsePlot checks a ```plot body and splits it into panels.
func parsePlot(source string) (*plotSpec, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal([]byte(source), &top); err != nil {
		return nil, fmt.Errorf("the body must be a JSON object: %w", err)
	}
	for key, v := range top {
		var generic any
		_ = json.Unmarshal(v, &generic)
		if key == "legend" || key == "xlabel" || key == "cols" || key == "narrowCols" || key == "data" {
			continue // checked by plotField; data rows hold values, not options (render-figures.py checks what is painted)
		}
		if err := checkPlotColors(generic, key); err != nil {
			return nil, err
		}
	}
	spec := &plotSpec{Cols: 1, Narrow: 1}
	_, many := top["panels"]
	for key, v := range top {
		switch {
		case slices.Contains(plotKeys, key):
			if err := plotField(spec, key, v); err != nil {
				return nil, err
			}
		case many:
			return nil, fmt.Errorf("unknown key %q; with panels, panel options go inside each panel", key)
		case !slices.Contains(plotPanelKeys, key):
			return nil, fmt.Errorf("unknown key %q; a panel takes %s", key, strings.Join(plotPanelKeys, ", "))
		}
	}
	if !many {
		single := map[string]json.RawMessage{}
		for key, v := range top {
			if slices.Contains(plotPanelKeys, key) {
				single[key] = v
			}
		}
		spec.Panels = []map[string]json.RawMessage{single}
	}
	if len(spec.Panels) == 0 || len(spec.Panels) > 16 {
		return nil, fmt.Errorf("needs 1 to 16 panels")
	}
	if spec.Cols < 1 || spec.Cols > 5 || spec.Cols > len(spec.Panels) {
		return nil, fmt.Errorf("cols must be 1 to 5 and at most the number of panels")
	}
	if spec.Narrow < 1 || spec.Narrow > 2 || spec.Narrow > spec.Cols {
		return nil, fmt.Errorf("narrowCols must be 1 or 2 and at most cols")
	}
	for i, panel := range spec.Panels {
		p, err := spec.panel(panel)
		if err != nil {
			return nil, fmt.Errorf("panel %d: %w", i+1, err)
		}
		spec.drawn = append(spec.drawn, p)
	}
	return spec, nil
}

func plotField(spec *plotSpec, key string, v json.RawMessage) error {
	var err error
	switch key {
	case "data":
		err = json.Unmarshal(v, &spec.Data)
		for name, rows := range spec.Data {
			var list []any
			if json.Unmarshal(rows, &list) != nil {
				return fmt.Errorf("data %q must be a list", name)
			}
		}
	case "panels":
		err = json.Unmarshal(v, &spec.Panels)
	case "legend":
		if err = json.Unmarshal(v, &spec.Legend); err == nil {
			for _, l := range spec.Legend {
				m := figureToken.FindStringSubmatch(l.Color)
				if l.Label == "" || m == nil || m[0] != l.Color || !slices.Contains(figureTokens, m[1]) || !slices.Contains(plotLegendShapes, l.Shape) {
					return fmt.Errorf("each legend entry needs a label, a color var(--name) and a shape (%s)", strings.Join(plotLegendShapes, ", "))
				}
				if _, mathErr := inlineMathHTML(l.Label); mathErr != nil {
					return mathErr
				}
			}
		}
	case "cols":
		err = json.Unmarshal(v, &spec.Cols)
	case "narrowCols":
		err = json.Unmarshal(v, &spec.Narrow)
	case "xlabel":
		if err = json.Unmarshal(v, &spec.XLabel); err == nil {
			_, err = inlineMathHTML(spec.XLabel)
		}
	}
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	return nil
}

// panel checks one panel and inlines the data its marks name, so the request
// for its drawing holds everything the drawing depends on.
func (spec *plotSpec) panel(panel map[string]json.RawMessage) (plotPanel, error) {
	var p plotPanel
	for key := range panel {
		if !slices.Contains(plotPanelKeys, key) {
			return p, fmt.Errorf("unknown key %q; a panel takes %s", key, strings.Join(plotPanelKeys, ", "))
		}
	}
	if t, ok := panel["title"]; ok {
		if err := json.Unmarshal(t, &p.title); err != nil {
			return p, fmt.Errorf("title must be a string")
		}
		if _, err := inlineMathHTML(p.title); err != nil {
			return p, err
		}
	}
	// Smaller panels are shorter; each can say otherwise.
	p.height = []int{320, 260, 220, 200, 200}[spec.Cols-1]
	p.narrow = []int{240, 180}[spec.Narrow-1]
	for key, h := range map[string]*int{"height": &p.height, "narrowHeight": &p.narrow} {
		if v, ok := panel[key]; ok {
			if err := json.Unmarshal(v, h); err != nil || *h < 100 || *h > 720 {
				return p, fmt.Errorf("%s must be a number of pixels from 100 to 720", key)
			}
		}
	}
	var marks []map[string]json.RawMessage
	if err := json.Unmarshal(panel["marks"], &marks); err != nil || len(marks) == 0 {
		return p, fmt.Errorf("marks must be a non-empty list of objects")
	}
	for i, mark := range marks {
		if err := spec.mark(mark); err != nil {
			return p, fmt.Errorf("mark %d: %w", i+1, err)
		}
	}
	if f, ok := panel["facet"]; ok {
		var facet map[string]json.RawMessage
		if json.Unmarshal(f, &facet) != nil {
			return p, fmt.Errorf("facet must be an object")
		}
		if err := spec.inline(facet); err != nil {
			return p, fmt.Errorf("facet: %w", err)
		}
		panel["facet"], _ = json.Marshal(facet)
	}
	options := map[string]any{}
	for key, v := range panel {
		if key != "title" && key != "height" && key != "narrowHeight" && key != "marks" {
			options[key] = v
		}
	}
	options["marks"] = marks
	data, err := json.Marshal(options) // map keys are sorted, so the request is stable
	if err != nil {
		return p, err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, data); err != nil {
		return p, err
	}
	p.options = compact.String()
	return p, nil
}

func (spec *plotSpec) mark(mark map[string]json.RawMessage) error {
	var name string
	if json.Unmarshal(mark["mark"], &name) != nil || !slices.Contains(plotMarks, name) {
		return fmt.Errorf("mark must be one of %s", strings.Join(plotMarks, ", "))
	}
	if t, ok := mark["transform"]; ok {
		var transform string
		if json.Unmarshal(t, &transform) != nil || !slices.Contains(plotTransforms, transform) {
			return fmt.Errorf("transform must be one of %s", strings.Join(plotTransforms, ", "))
		}
	} else if _, ok := mark["with"]; ok {
		return fmt.Errorf("with is the transform's options; it needs a transform")
	}
	if f, ok := mark["filter"]; ok {
		var filter map[string]any
		if json.Unmarshal(f, &filter) != nil {
			return fmt.Errorf("filter must be an object of field: value (or a list of values)")
		}
	}
	if t, ok := mark["tip"]; ok {
		var all bool
		var fields []string
		if json.Unmarshal(t, &all) != nil && (json.Unmarshal(t, &fields) != nil || len(fields) == 0) {
			return fmt.Errorf("tip must be true or a list of field names")
		}
	}
	for _, key := range []string{"title", "href", "target", "ariaLabel", "ariaDescription"} {
		if _, ok := mark[key]; ok {
			return fmt.Errorf("%s is not drawn into a static figure; use tip for hover text", key)
		}
	}
	return spec.inline(mark)
}

// inline replaces a named data set with its rows.
func (spec *plotSpec) inline(mark map[string]json.RawMessage) error {
	d, ok := mark["data"]
	if !ok {
		return nil
	}
	var ref string
	if json.Unmarshal(d, &ref) == nil {
		rows, ok := spec.Data[ref]
		if !ok {
			return fmt.Errorf("data %q is not in the figure's data", ref)
		}
		mark["data"] = rows
		return nil
	}
	var list []any
	if json.Unmarshal(d, &list) != nil {
		return fmt.Errorf("data must be a list or the name of one in the figure's data")
	}
	return nil
}

// checkPlotColors keeps a plot to the style.css palette like checkColors,
// but by Plot's names: a string under fill or stroke is a color or a field
// name, so only fixed colors are caught there; a scale's range and the
// legend's colors must be tokens; a named color scheme is never a token.
func checkPlotColors(v any, key string) error {
	switch v := v.(type) {
	case string:
		colorKey := key == "range" || key == "unknown" || key == "color"
		if err := checkColors(v, colorKey); err != nil {
			return err
		}
	case []any:
		for _, x := range v {
			if err := checkPlotColors(x, key); err != nil {
				return err
			}
		}
	case map[string]any:
		for k, x := range v {
			if k == "data" {
				continue // values, not options
			}
			if k == "scheme" || k == "interpolate" || k == "legend" {
				return fmt.Errorf("%s is not supported: give a scale's colors as range with var(--name), and the legend in the spec's legend", k)
			}
			if err := checkPlotColors(x, k); err != nil {
				return err
			}
		}
	}
	return nil
}

// plotWidths are a panel's widths in the reading column and on a 390 px
// phone (324 px column); the grid's gaps are 24 and 16 px (style.css).
func (spec *plotSpec) plotWidths() (wide, phone int) {
	return (figureWidth - 24*(spec.Cols-1)) / spec.Cols, (324 - 16*(spec.Narrow-1)) / spec.Narrow
}

// renderPlot writes the figure's panels; both drawings of each are there and
// style.css shows the one that fits.
func renderPlot(w *bytes.Buffer, f *figureBlock) {
	spec := f.plot
	title, _ := inlineMathHTML(f.title)
	fmt.Fprintf(w, `<figure class="plotfig"><figcaption>%s</figcaption>`, title)
	if len(spec.Legend) > 0 {
		w.WriteString(`<ul class="plot-legend">`)
		for _, l := range spec.Legend {
			label, _ := inlineMathHTML(l.Label)
			fmt.Fprintf(w, `<li class="%s" style="--c:%s">%s</li>`, l.Shape, html.EscapeString(l.Color), label)
		}
		w.WriteString(`</ul>`)
	}
	// The drawings are hidden from screen readers (render-figures.py); the
	// caption, panel titles and note are what they read.
	fmt.Fprintf(w, `<div class="plot-grid" style="--cols:%d;--ncols:%d">`, spec.Cols, spec.Narrow)
	for _, p := range spec.drawn {
		w.WriteString(`<div class="plot-panel">`)
		if p.title != "" {
			pTitle, _ := inlineMathHTML(p.title)
			fmt.Fprintf(w, `<p class="plot-title">%s</p>`, pTitle)
		}
		fmt.Fprintf(w, `<div class="wide">%s</div><div class="phone">%s</div></div>`, p.wide, p.phone)
	}
	w.WriteString(`</div><!--/plot-grid-->`) // where the feed's link replaces the drawings (feed.go)
	if spec.XLabel != "" {
		xlabel, _ := inlineMathHTML(spec.XLabel)
		fmt.Fprintf(w, `<p class="plot-xlabel">%s</p>`, xlabel)
	}
	if f.note != "" {
		note, _ := inlineMathHTML(f.note)
		fmt.Fprintf(w, `<p class="figure-note">%s</p>`, note)
	}
	w.WriteString("</figure>\n")
}
