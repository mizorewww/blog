package main

import (
	"fmt"
	"strings"
	"testing"

	"github.com/yuin/goldmark/ast"
)

func TestPlot(t *testing.T) {
	src := "```plot title=\"图\" note=\"注\"\n" + `{"cols": 2, "narrowCols": 1, "xlabel": "算力",
  "legend": [{"label": "拟合", "color": "var(--teal)", "shape": "line"}],
  "data": {"p": [{"c": 1, "n": 2}, {"c": 10, "n": 20}]},
  "panels": [
    {"title": "N*", "x": {"type": "log"}, "marks": [{"mark": "dot", "data": "p", "x": "c", "y": "n", "fill": "var(--clay)", "tip": ["n"]}]},
    {"title": "D*", "height": 300, "marks": [{"mark": "ruleY", "data": [1], "stroke": "var(--ink)"}]}
  ]}` + "\n```\n"
	var requests []string
	body, _, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{figure: func(f *figureBlock) error {
		for i := range f.plot.drawn {
			p := &f.plot.drawn[i]
			requests = append(requests, p.options)
			p.wide, p.phone = "<svg>w</svg>", "<svg>p</svg>"
		}
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{
		`<figure class="plotfig"><figcaption>图</figcaption><ul class="plot-legend"><li class="line" style="--c:var(--teal)">拟合</li></ul>`,
		`<div class="plot-grid" style="--cols:2;--ncols:1">`,
		`<p class="plot-title">N*</p><div class="wide"><svg>w</svg></div><div class="phone"><svg>p</svg></div>`,
		`<p class="plot-xlabel">算力</p><p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	// Named data is inlined, so a panel's request holds all it depends on.
	if len(requests) != 2 || !strings.Contains(requests[0], `"data":[{"c":1,"n":2},{"c":10,"n":20}]`) || strings.Contains(requests[0], `"title"`) {
		t.Fatalf("requests: %v", requests)
	}
	feed := feedContent(html, "https://example.com/p/", languages[0].UI)
	if strings.Contains(feed, "<svg") || strings.Contains(feed, "plot-legend") || !strings.Contains(feed, `<p class="plot-xlabel">`) {
		t.Fatalf("feed: %s", feed)
	}

	// Data rows may use any field names, including ones that are options elsewhere.
	if _, err := parsePlot(`{"data": {"d": [{"scheme": "cosine", "color": "RGB"}]}, "marks": [{"mark": "dot", "data": "d", "x": "scheme"}]}`); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		`{"marks": []}`,
		`{"marks": [{"mark": "pie"}]}`,
		`{"marks": [{"mark": "dot", "data": "missing"}]}`,
		`{"marks": [{"mark": "dot", "fill": "#ff0000"}]}`,
		`{"color": {"scheme": "reds"}, "marks": [{"mark": "dot"}]}`,
		`{"color": {"range": ["red"]}, "marks": [{"mark": "dot"}]}`,
		`{"title": "x", "caption": "y", "marks": [{"mark": "dot"}]}`,
		`{"marks": [{"mark": "dot", "transform": "eval"}]}`,
		`{"marks": [{"mark": "dot", "with": {}}]}`,
		`{"marks": [{"mark": "dot", "href": "x"}]}`,
		`{"panels": [{"marks": [{"mark": "dot"}]}], "cols": 2}`,
		`{"panels": [{"marks": [{"mark": "dot"}]}], "x": {}}`,
		`{"height": 50, "marks": [{"mark": "dot"}]}`,
		`[1]`,
		`{"legend": [{"label": "a", "color": "var(--ink);background:url(x)", "shape": "dot"}], "marks": [{"mark": "dot"}]}`,
		`{"legend": [{"label": "a", "color": "var(--typo)", "shape": "dot"}], "marks": [{"mark": "dot"}]}`,
		`{"marks": [{"mark": "dot", "transform": "pointer"}]}`,
		`{"facet": {"data": "missing", "y": "m"}, "marks": [{"mark": "dot"}]}`,
	} {
		if _, err := parsePlot(bad); err == nil {
			t.Errorf("%s: want an error", bad)
		}
	}
}

func TestSketchImage(t *testing.T) {
	src := "```sketch title=\"图\"\n<svg viewBox=\"0 0 400 120\"><image href=\"../images/a.jpg\" x=\"0\" y=\"0\" width=\"100\" height=\"80\"/></svg>\n```\n"
	body, _, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{image: func(img *ast.Image) error {
		img.Destination = []byte("/images/abc.webp")
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `<image href="/images/abc.webp" x="0"`) {
		t.Fatalf("the picture must be linked in: %s", body)
	}
	for _, bad := range []string{
		`<svg viewBox="0 0 10 10"><image href="https://example.com/a.jpg" width="1" height="1"/></svg>`,
		`<svg viewBox="0 0 10 10"><image href="a.jpg"/></svg>`,
		`<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AA" width="1" height="1"/></svg>`,
	} {
		if _, err := sketchSVG(bad); err == nil {
			t.Errorf("%s: want an error", bad)
		}
	}
	// Found the way sketchSVG reads them: not in comments, any quoting.
	if got := sketchImages(`<svg><!-- <image href="a.jpg"/> --><image href='b.jpg'/></svg>`); len(got) != 1 || got[0] != "b.jpg" {
		t.Fatalf("images: %v", got)
	}
	for _, bad := range []string{} {
		if _, err := sketchSVG(bad); err == nil {
			t.Errorf("%s: want an error", bad)
		}
	}
}

func TestVideo(t *testing.T) {
	image := func(dest string, w, h int) *ast.Image {
		img := ast.NewImage(ast.NewLink())
		img.Destination = []byte(dest)
		if w > 0 {
			img.SetAttributeString("width", []byte(fmt.Sprint(w)))
			img.SetAttributeString("height", []byte(fmt.Sprint(h)))
		}
		return img
	}
	lines := []string{"../m/a.mp4 | 曲面<扫过>", "../m/a.jpg"}
	out, err := renderVideo(`video title="T" note="N" autoplay="true"`, lines, []*ast.Image{image("/images/a.mp4", 0, 0), image("/images/a.webp", 640, 360)})
	if err != nil {
		t.Fatal(err)
	}
	want := `<figure class="video"><figcaption>T</figcaption><video src="/images/a.mp4" poster="/images/a.webp" width="640" height="360" controls muted playsinline preload="none" aria-label="曲面&lt;扫过&gt;" loop data-autoplay></video><p class="figure-note">N</p></figure>`
	if strings.TrimSpace(out) != want {
		t.Fatalf("got %s", out)
	}
	for _, c := range []struct {
		info  string
		lines []string
	}{
		{`video note="N"`, lines},
		{`video title="T" autoplay="yes"`, lines},
		{`video title="T"`, []string{"../m/a.mp4", "../m/a.jpg"}},
		{`video title="T"`, []string{"../m/a.jpg | x", "../m/a.mp4"}},
		{`video title="T"`, []string{"https://example.com/a.mp4 | x", "../m/a.jpg"}},
	} {
		if _, err := renderVideo(c.info, c.lines, []*ast.Image{image("/a", 0, 0), image("/b", 640, 360)}); err == nil {
			t.Errorf("%s %v: want an error", c.info, c.lines)
		}
	}
}
