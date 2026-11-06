package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFigures(t *testing.T) {
	src := "```echarts title=\"调用 <x>\" note=\"注\" height=\"300\"\n{\"xAxis\": {\"type\": \"category\", \"data\": [\"</script>\"]}, \"yAxis\": {},\n \"series\": [{\"type\": \"bar\", \"data\": [1], \"itemStyle\": {\"color\": \"var(--clay)\"}}]}\n```\n\n" +
		"```mermaid title=\"流程\"\nflowchart TD\n  A --> B\n```\n"
	var drawn []string
	body, _, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{figure: func(f *figureBlock) error {
		drawn = append(drawn, f.Lang)
		f.SVG = "<svg><text>" + f.Lang + "</text></svg>"
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{
		`<figure class="echart" style="--h:300px"><figcaption>调用 &lt;x&gt;</figcaption><div class="figure-plot" role="img" aria-label="调用 &lt;x&gt;"><svg><text>echarts</text></svg></div>`,
		`<script type="application/json">{"xAxis":{"type":"category","data":["` + "\\u003c/script\\u003e" + `"]},"yAxis":{},"series":[{"type":"bar","data":[1],"itemStyle":{"color":"var(--clay)"}}]}</script><p class="figure-note">注</p></figure>`,
		`<figure class="diagram"><figcaption>流程</figcaption><div class="figure-plot" role="img" aria-label="流程"><svg><text>mermaid</text></svg></div></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	if h := diagramHeight(`<svg id="d" width="100%" viewBox="4 4 1408 300.4" style="max-width: 1408px;">`); h != 150 {
		t.Fatalf("diagramHeight = %d, want 150 in the 704 px column", h)
	}
	if h := diagramHeight(`<svg viewBox="0 0 352 100">`); h != 100 {
		t.Fatalf("diagramHeight = %d, want the natural 100", h)
	}
	if strings.Join(drawn, ",") != "echarts,mermaid" {
		t.Fatalf("drawn %v", drawn)
	}
	for _, bad := range []string{
		"```echarts\n{\"series\": []}\n```\n",
		"```echarts title=\"T\"\n[1, 2]\n```\n",
		"```echarts title=\"T\"\n{\"xAxis\": {}}\n```\n",
		"```echarts title=\"T\" height=\"90\"\n{\"series\": []}\n```\n",
		"```echarts title=\"T\" width=\"300\"\n{\"series\": []}\n```\n",
		"```echarts title=\"T\"\n{\"series\": [{\"color\": \"#d97757\"}]}\n```\n",
		"```echarts title=\"T\"\n{\"series\": [{\"color\": \"rgba(0,0,0,.5)\"}]}\n```\n",
		"```echarts title=\"T\"\n{\"series\": [{\"color\": \"var(--green2)\"}]}\n```\n",
		"```mermaid title=\"T\" height=\"300\"\nflowchart TD\n  A --> B\n```\n",
		"```mermaid title=\"T\"\n```\n",
		"```echarts title=\"T\"\n{\"series\": []}\n```\n",
		"```echarts title=\"T\"\n{\"series\": {\"type\": \"bar\"}}\n```\n",
		"```echarts title=\"T\"\n{\"series\": [{\"itemStyle\": {\"color\": \"red\"}}]}\n```\n",
		"```echarts title=\"T\"\n{\"visualMap\": {\"inRange\": {\"color\": [\"var(--wash)\", \"orange\"]}}, \"series\": [{}]}\n```\n",
		"```mermaid title=\"T\"\nflowchart TD\n  A --> B\n  style A fill:#f00\n```\n",
		"```mermaid title=\"T\"\nflowchart TD\n  A --> B\n  classDef hot stroke:red\n```\n",
	} {
		if _, _, err := render([]byte(bad), nil); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
}

// A figure's text is in its SVG and option, which other drawings and scripts are not.
func TestFigureText(t *testing.T) {
	page := `<div class="prose"><figure class="echart"><div class="figure-plot"><svg><text>甲</text><style>乙</style></svg></div><script type="application/json">{"name":"丙"}</script></figure>` +
		`<svg><text>丁</text></svg><script>戊</script></div>`
	first, _ := pageText(page)
	for r, want := range map[rune]bool{'甲': true, '丙': true, '乙': false, '丁': false, '戊': false} {
		if first[sans400][r] != want {
			t.Errorf("%c collected = %v, want %v", r, !want, want)
		}
	}
	if text := contentText(page); strings.Contains(text, "丙") || strings.Contains(text, "甲") {
		t.Fatalf("search text holds a figure: %q", text)
	}
}

// A warm build draws from the cache without uv; a failed drawing is not cached.
func TestFigureCache(t *testing.T) {
	dir := t.TempDir()
	for _, name := range figureInputs {
		data, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.MkdirAll(filepath.Join(dir, filepath.Dir(name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	t.Setenv("PATH", "")
	var d figureDrawer
	f := &figureBlock{Lang: "mermaid", source: "flowchart TD\n  A --> B\n"}
	if err := d.draw(f); err == nil {
		t.Fatal("a cache miss without uv must fail")
	}
	if entries, _ := os.ReadDir(figureCache); len(entries) != 0 {
		t.Fatal("a failed drawing must not be cached")
	}
	request, _ := json.Marshal(figureRequest{f.Lang, f.source, figureWidth, f.height})
	path, err := d.cached(request)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(figureCache, 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("<svg>cached</svg>"), 0644); err != nil {
		t.Fatal(err)
	}
	d = figureDrawer{}
	if err := d.draw(f); err != nil || f.SVG != "<svg>cached</svg>" {
		t.Fatalf("draw = %v, %q", err, f.SVG)
	}
	if err := d.close(); err != nil {
		t.Fatal(err)
	}
}

// Only pages with an ```echarts figure carry the script, which loads the vendored ECharts.
func TestFigureScript(t *testing.T) {
	scripts, err := loadScripts("/static/v1/" + echartsFile)
	if err != nil {
		t.Fatal(err)
	}
	with := string(scripts.For(Page{Post: &Post{Content: `<figure class="echart" style="--h:360px">`}}))
	if !strings.Contains(with, "chartTheme") || !strings.Contains(with, `"/static/v1/vendor/echarts-6.1.0.min.js"`) || strings.Contains(with, "{{") {
		t.Fatal("a page with an echarts figure must load ECharts from the versioned assets")
	}
	if without := string(scripts.For(Page{Post: &Post{Content: `<figure class="diagram">`}})); strings.Contains(without, "chartTheme") {
		t.Fatal("diagrams need no script")
	}
	if _, err := os.Stat(filepath.Join("static", echartsFile)); err != nil {
		t.Fatal(err)
	}
}
