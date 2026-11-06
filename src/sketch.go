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
//   - ids are scoped to the drawing, and url(#arrow) is the house arrowhead.
//
// A second <svg>, at most 400 wide, is the same figure laid out for a phone:
// the page shows it instead of the first below 640 px (style.css).
var (
	sketchElements = []string{"svg", "g", "rect", "circle", "ellipse", "line", "path", "polyline", "polygon", "text", "tspan", "title", "desc", "defs", "marker", "use", "symbol", "clipPath"}
	sketchAttrs    = []string{"viewBox", "class", "id", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "d", "points",
		"fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity",
		"text-anchor", "dominant-baseline", "font-size", "letter-spacing", "dx", "dy", "href", "clip-path", "marker-start", "marker-mid", "marker-end",
		"markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "preserveAspectRatio"}
	sketchPaint   = []string{"fill", "stroke"}
	sketchURL     = regexp.MustCompile(`^url\(#([\w-]+)\)$`)
	sketchViewBox = regexp.MustCompile(`^0 0 ([\d.]+) ([\d.]+)$`)
)

// sketchNarrow is the widest a phone drawing may be.
const sketchNarrow = 400

// The house arrowhead, an open chevron in the edge color (style.css .arrowhead).
const sketchArrow = `<marker id="%s-arrow" class="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M2 1.5 8 5 2 8.5"/></marker>`

// sketchSVG checks a sketch and returns it ready for the page.
func sketchSVG(source string) (string, error) {
	sum := sha256.Sum256([]byte(source))
	var out strings.Builder
	decoder := xml.NewDecoder(strings.NewReader(source))
	depth := 0
	var prefixes []string // one id scope per drawing
	var widths []float64
	arrows := map[int]bool{}
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
				return "", fmt.Errorf("<%s> is not allowed here; a sketch is an <svg> of %s, and optionally a narrow second <svg> for phones", name, strings.Join(sketchElements[1:], ", "))
			}
			if depth == 0 {
				if len(prefixes) == 2 {
					return "", fmt.Errorf("a sketch has at most two <svg>: the drawing and its phone layout")
				}
				prefixes = append(prefixes, fmt.Sprintf("sketch-%x-%d", sum[:4], len(prefixes)))
				widths = append(widths, 0)
			}
			root := len(prefixes) - 1
			scope := func(id string) string { return prefixes[root] + "-" + id }
			var attrs, style []string
			for _, a := range t.Attr {
				key, value := a.Name.Local, a.Value
				if a.Name.Space == "xmlns" || key == "xmlns" {
					continue
				}
				if !slices.Contains(sketchAttrs, key) {
					return "", fmt.Errorf("<%s %s> is not allowed; use the classes in style.css (.sketch) for looks", name, key)
				}
				if depth == 0 {
					switch key {
					case "viewBox":
						m := sketchViewBox.FindStringSubmatch(value)
						if m == nil {
							return "", fmt.Errorf(`viewBox must be "0 0 width height"`)
						}
						widths[root], _ = strconv.ParseFloat(m[1], 64)
						attrs = append(attrs, fmt.Sprintf(`viewBox="%s"`, value))
					case "width", "height", "class", "preserveAspectRatio":
						// the page sizes and styles the drawing
					default:
						return "", fmt.Errorf("<svg %s> is not allowed; put it on an element inside", key)
					}
					continue
				}
				switch {
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
					arrows[root] = arrows[root] || m[1] == "arrow"
					value = "url(#" + scope(m[1]) + ")"
				}
				attrs = append(attrs, fmt.Sprintf(`%s="%s"`, key, xmlEscape(value)))
			}
			if depth == 0 {
				if widths[root] == 0 {
					return "", fmt.Errorf(`each <svg> needs viewBox="0 0 width height"`)
				}
				// Class and arrowhead are known only once every drawing is read.
				attrs = append(attrs, fmt.Sprintf("\x00class%d\x00", root), `xmlns="http://www.w3.org/2000/svg"`, fmt.Sprintf(`style="max-width:%gpx"`, widths[root]))
			}
			if len(style) > 0 {
				attrs = append(attrs, `style="`+strings.Join(style, ";")+`"`)
			}
			fmt.Fprintf(&out, "<%s %s>", name, strings.Join(attrs, " "))
			if depth == 0 {
				fmt.Fprintf(&out, "\x00arrow%d\x00", root)
			}
			depth++
		case xml.EndElement:
			depth--
			fmt.Fprintf(&out, "</%s>", t.Name.Local)
		case xml.CharData:
			if depth > 0 {
				out.WriteString(xmlEscape(string(t)))
			} else if strings.TrimSpace(string(t)) != "" {
				return "", fmt.Errorf("text outside the <svg>")
			}
		case xml.Comment, xml.ProcInst, xml.Directive:
			// dropped
		}
	}
	if depth != 0 || len(prefixes) == 0 {
		return "", fmt.Errorf("is not a complete <svg>")
	}
	classes := []string{`class="sketch"`}
	if len(prefixes) == 2 {
		if widths[1] > sketchNarrow || widths[1] >= widths[0] {
			return "", fmt.Errorf("the second <svg> is the phone layout: at most %d wide and narrower than the first", sketchNarrow)
		}
		classes = []string{`class="sketch wide"`, `class="sketch narrow"`}
	}
	svg := out.String()
	for i, prefix := range prefixes {
		defs := ""
		if arrows[i] {
			defs = "<defs>" + fmt.Sprintf(sketchArrow, prefix) + "</defs>"
		}
		svg = strings.Replace(svg, fmt.Sprintf("\x00arrow%d\x00", i), defs, 1)
		svg = strings.Replace(svg, fmt.Sprintf("\x00class%d\x00", i), classes[i], 1)
	}
	return svg, nil
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return strings.ReplaceAll(b.String(), "&#xA;", "\n")
}
