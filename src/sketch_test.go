package main

import (
	"strings"
	"testing"
)

func TestSketch(t *testing.T) {
	src := "```sketch title=\"图\" note=\"注\"\n<svg viewBox=\"0 0 400 120\" width=\"400\">\n" +
		"<rect class=\"panel\" x=\"0\" y=\"0\" width=\"400\" height=\"120\" rx=\"12\"/>\n" +
		"<g class=\"node blue\"><rect id=\"a\" x=\"10\" y=\"10\" width=\"80\" height=\"30\"/><text x=\"50\" y=\"25\">A &amp; &lt;b&gt;</text></g>\n" +
		"<path class=\"edge\" d=\"M90 25 H200\" marker-end=\"url(#arrow)\"/>\n" +
		"<use href=\"#a\" x=\"200\"/><circle cx=\"5\" cy=\"5\" r=\"2\" fill=\"var(--clay)\"/>\n</svg>\n```\n"
	body, _, err := render([]byte(src), nil)
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{
		`<figure class="diagram" style="--h:120px"><figcaption>图</figcaption><div class="figure-plot" role="img" aria-label="图"><svg viewBox="0 0 400 120" class="sketch"`,
		`<svg viewBox="0 0 400 120" class="sketch" xmlns="http://www.w3.org/2000/svg" style="max-width:400px"><defs><marker id="sketch-`,
		`<text x="50" y="25">A &amp; &lt;b&gt;</text>`,
		`style="fill:var(--clay)"`,
		`<p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	// Ids are scoped to the figure and references follow them.
	if strings.Contains(html, `id="a"`) || strings.Contains(html, `url(#arrow)`) || !strings.Contains(html, `-arrow)"`) || !strings.Contains(html, `-a"`) {
		t.Fatalf("ids must be scoped: %s", html)
	}
	if root := html[strings.Index(html, "<svg"):]; strings.Contains(root[:strings.Index(root, ">")], ` width=`) {
		t.Fatal("the page sizes the drawing")
	}
	for _, bad := range []string{
		`<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>`,
		`<svg viewBox="0 0 10 10"><rect onclick="alert(1)"/></svg>`,
		`<svg viewBox="0 0 10 10"><rect style="fill:red"/></svg>`,
		`<svg viewBox="0 0 10 10"><rect fill="#f00"/></svg>`,
		`<svg viewBox="0 0 10 10"><rect fill="var(--nope)"/></svg>`,
		`<svg viewBox="0 0 10 10"><foreignObject/></svg>`,
		`<svg viewBox="0 0 10 10"><use href="https://example.com/a.svg#x"/></svg>`,
		`<svg viewBox="0 0 10 10"><path marker-end="url(https://x/#a)"/></svg>`,
		`<svg viewBox="0 0 10 10"><svg viewBox="0 0 1 1"/></svg>`,
		`<svg><rect/></svg>`,
		`<svg viewBox="5 5 10 10"><rect/></svg>`,
		`<svg viewBox="0 0 10 10"><rect>`,
		`<rect/>`,
		`<svg viewBox="0 0 10 10" fill="var(--clay)"><rect/></svg>`,
		`<svg viewBox="0 0 10 10"><linearGradient/></svg>`,
		`<svg viewBox="0 0 10 10"><rect/></svg>text`,
		`<svg viewBox="0 0 704 10"><rect/></svg><svg viewBox="0 0 500 10"><rect/></svg>`,
		`<svg viewBox="0 0 704 10"/><svg viewBox="0 0 300 10"/><svg viewBox="0 0 200 10"/>`,
	} {
		if _, _, err := render([]byte("```sketch title=\"T\"\n"+bad+"\n```\n"), nil); err == nil {
			t.Errorf("expected an error for %s", bad)
		}
	}
}

// A second drawing is the phone layout: its own ids and arrowhead, shown below 640 px.
func TestSketchPhoneLayout(t *testing.T) {
	both := `<svg viewBox="0 0 704 100"><rect id="a"/><path class="edge" marker-end="url(#arrow)"/></svg>` +
		`<svg viewBox="0 0 340 200"><rect id="a"/><path class="edge" marker-end="url(#arrow)"/></svg>`
	body, _, err := render([]byte("```sketch title=\"T\"\n"+both+"\n```\n"), nil)
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{`style="--h:100px;--hn:191px"`, `class="sketch wide"`, `class="sketch narrow"`, `-0-a"`, `-1-a"`, `-0-arrow)"`, `-1-arrow)"`} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	if strings.Count(html, `<marker `) != 2 {
		t.Fatal("each drawing needs its own arrowhead")
	}
}
