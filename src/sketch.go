package main

import (
	"crypto/sha256"
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// A ```sketch fence is a hand-drawn SVG: panels, nodes, tags and edges in
// the house style of style.css (.sketch), where Mermaid's automatic layout
// is not enough. It is checked and rewritten at build time, never drawn:
//
//   - only drawing elements and attributes pass; scripts, styles, foreign
//     content, events and external references fail the build;
//   - paint is a class, none, currentColor or var(--token), so the drawing
//     follows the color scheme;
//   - ids are scoped to the figure, and url(#arrow) is the house arrowhead.
var (
	sketchElements = []string{"svg", "g", "rect", "circle", "ellipse", "line", "path", "polyline", "polygon", "text", "tspan", "title", "desc", "defs", "marker", "use", "symbol", "clipPath", "linearGradient", "stop"}
	sketchAttrs    = []string{"viewBox", "class", "id", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
		"fill", "stroke", "stop-color", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "offset",
		"text-anchor", "dominant-baseline", "font-size", "letter-spacing", "dx", "dy", "href", "clip-path", "marker-start", "marker-mid", "marker-end",
		"markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "gradientUnits", "gradientTransform", "preserveAspectRatio"}
	sketchPaint   = []string{"fill", "stroke", "stop-color"}
	sketchURL     = regexp.MustCompile(`^url\(#([\w-]+)\)$`)
	sketchViewBox = regexp.MustCompile(`^0 0 ([\d.]+) ([\d.]+)$`)
)

// The house arrowhead, an open chevron in the edge color (style.css .arrowhead).
const sketchArrow = `<marker id="%s-arrow" class="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M2 1.5 8 5 2 8.5"/></marker>`

// sketchSVG checks a sketch and returns it ready for the page.
func sketchSVG(source string) (string, error) {
	sum := sha256.Sum256([]byte(source))
	prefix := fmt.Sprintf("sketch-%x", sum[:4])
	scope := func(id string) string { return prefix + "-" + id }
	var out strings.Builder
	decoder := xml.NewDecoder(strings.NewReader(source))
	depth, arrow, width := 0, false, 0.0
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("not well-formed SVG: %w", err)
		}
		switch t := token.(type) {
		case xml.StartElement:
			name := t.Name.Local
			if !slices.Contains(sketchElements, name) || (depth == 0) != (name == "svg") {
				return "", fmt.Errorf("<%s> is not allowed here; a sketch is one <svg> of %s", name, strings.Join(sketchElements[1:], ", "))
			}
			var attrs []string
			var style []string
			for _, a := range t.Attr {
				key, value := a.Name.Local, a.Value
				if a.Name.Space == "xmlns" || key == "xmlns" {
					continue
				}
				if !slices.Contains(sketchAttrs, key) {
					return "", fmt.Errorf("<%s %s> is not allowed; use the classes in style.css (.sketch) for looks", name, key)
				}
				switch {
				case depth == 0 && key == "viewBox":
					m := sketchViewBox.FindStringSubmatch(value)
					if m == nil {
						return "", fmt.Errorf(`viewBox must be "0 0 width height"`)
					}
					width, _ = strconv.ParseFloat(m[1], 64)
				case depth == 0 && (key == "width" || key == "height"):
					continue // the page sizes the drawing
				case slices.Contains(sketchPaint, key):
					if value == "none" || value == "currentColor" {
						break
					}
					if m := figureToken.FindStringSubmatch(value); m != nil && m[0] == value && slices.Contains(figureTokens, m[1]) {
						style = append(style, key+":"+value) // presentation attributes take no var()
						continue
					}
					return "", fmt.Errorf(`%s=%q: paint is a class, none, currentColor or var(--name) with one of %s`, key, value, strings.Join(figureTokens, ", "))
				case key == "id":
					value = scope(value)
				case key == "href":
					if !strings.HasPrefix(value, "#") {
						return "", fmt.Errorf("href %q must point inside the sketch (#id)", value)
					}
					value = "#" + scope(value[1:])
				case strings.HasPrefix(key, "marker-") || key == "clip-path":
					m := sketchURL.FindStringSubmatch(value)
					if m == nil {
						return "", fmt.Errorf("%s=%q must be url(#id)", key, value)
					}
					arrow = arrow || m[1] == "arrow"
					value = "url(#" + scope(m[1]) + ")"
				}
				attrs = append(attrs, fmt.Sprintf(`%s="%s"`, key, xmlEscape(value)))
			}
			if depth == 0 {
				if width == 0 {
					return "", fmt.Errorf(`the <svg> needs viewBox="0 0 width height"`)
				}
				// Wide drawings keep a readable size on a phone and scroll sideways.
				attrs = append(attrs, `class="sketch"`, `xmlns="http://www.w3.org/2000/svg"`,
					fmt.Sprintf(`style="max-width:%gpx;min-width:min(%gpx,560px)"`, width, width))
				attrs = slices.DeleteFunc(attrs, func(a string) bool { return strings.HasPrefix(a, `class="`) && a != `class="sketch"` })
			}
			if len(style) > 0 {
				attrs = append(attrs, `style="`+strings.Join(style, ";")+`"`)
			}
			fmt.Fprintf(&out, "<%s %s>", name, strings.Join(attrs, " "))
			if depth == 0 {
				out.WriteString("\x00arrow\x00")
			}
			depth++
		case xml.EndElement:
			depth--
			fmt.Fprintf(&out, "</%s>", t.Name.Local)
		case xml.CharData:
			if depth > 0 {
				out.WriteString(xmlEscape(string(t)))
			}
		case xml.Comment, xml.ProcInst, xml.Directive:
			// dropped
		}
	}
	if depth != 0 || out.Len() == 0 {
		return "", fmt.Errorf("is not one complete <svg>")
	}
	defs := ""
	if arrow {
		defs = "<defs>" + fmt.Sprintf(sketchArrow, prefix) + "</defs>"
	}
	return strings.Replace(out.String(), "\x00arrow\x00", defs, 1), nil
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return strings.ReplaceAll(b.String(), "&#xA;", "\n")
}
