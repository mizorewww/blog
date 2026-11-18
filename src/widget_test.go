package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWidget(t *testing.T) {
	src := "```widget src=\"../widgets/demo/hero.js\" title=\"拖一拖 & <看>\" note=\"注\"\n" +
		"../images/still.png | 静态图 <a>\n" +
		"../images/still-narrow.png | 手机版\n```\n"
	var seen []string
	body, _, err := render([]byte(src), fakeImages("700", "400", &seen))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	if len(seen) != 2 || seen[0] != "../images/still.png" || seen[1] != "../images/still-narrow.png" {
		t.Fatalf("both stills must go through the image pipeline, in order: %v", seen)
	}
	for _, want := range []string{
		`<figure class="widget" data-src="../widgets/demo/hero.js"><figcaption>拖一拖 &amp; &lt;看&gt;</figcaption><div class="widget-stage">`,
		`<picture><source media="(max-width: 640px)" srcset="/img/small 720w, /img/still-narrow.png 1600w" sizes="calc(100vw - 32px)" width="700" height="400">`,
		`<img fetchpriority="low" class="widget-still" src="/img/still.png" alt="静态图 &lt;a&gt;"`,
		`</picture></div><p class="widget-hint">这是静态截图，开启 JavaScript 后可以操作。</p><p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("missing %s in\n%s", want, html)
		}
	}
	for _, bad := range []string{
		"```widget title=\"T\"\n../images/a.png\n```\n",                                  // no module
		"```widget src=\"a.js\"\n../images/a.png\n```\n",                                 // no title
		"```widget src=\"a.js\" title=\"T\"\n```\n",                                      // no still
		"```widget src=\"a.js\" title=\"T\" height=\"3\"\n../images/a.png\n```\n",        // unknown attribute
		"```widget src=\"a.js\" title=\"T\"\n../images/a.png\n../b.png\n../c.png\n```\n", // three stills
	} {
		if _, _, err := render([]byte(bad), fakeImages("10", "10", new([]string))); err == nil {
			t.Errorf("want an error for %q", bad)
		}
	}
}

func TestWidgetPublish(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	files := map[string]string{
		"content/widgets/demo/hero.js":   "export default () => {}",
		"content/widgets/demo/data.json": "{}",
		"content/widgets/demo/.DS_Store": "x",
		"content/widgets/demo/style.css": "",
		"content/widgets/bad/x.js":       "",
		"content/widgets/bad/notes.py":   "",
		"outside/evil.js":                "",
	}
	for name, body := range files {
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	p := widgetPublisher{stage: filepath.Join(dir, "stage"), prefix: "/blog"}
	var scripted string
	hook := p.hook("content/posts/x.md", &scripted)
	block := &widgetBlock{Info: `src="../widgets/demo/hero.js" title="T"`}
	if err := hook(block); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(block.Src, "/blog/widgets/demo-") || !strings.HasSuffix(block.Src, "/hero.js") {
		t.Fatalf("published at %s", block.Src)
	}
	folder := filepath.Join(p.stage, strings.TrimPrefix(filepath.Dir(block.Src), "/blog"))
	for name, want := range map[string]bool{"hero.js": true, "data.json": true, ".DS_Store": false} {
		if _, err := os.Stat(filepath.Join(folder, name)); (err == nil) != want {
			t.Errorf("%s published: %v, want %v", name, err == nil, want)
		}
	}
	if scripted != "{}export default () => {}" {
		t.Errorf("the post's fonts must cover the widget's scripts and data once: %q", scripted)
	}
	again := &widgetBlock{Info: block.Info}
	if err := hook(again); err != nil || again.Src != block.Src {
		t.Errorf("a folder is published once per build: %s vs %s (%v)", again.Src, block.Src, err)
	}
	if !block.Style {
		t.Error("the folder's style.css must be named on the figure")
	}
	if err := os.Symlink(filepath.Join(dir, "outside"), "content/widgets/link"); err != nil {
		t.Fatal(err)
	}
	for _, src := range []string{"../../outside/evil.js", "../widgets/demo/missing.js", "../widgets/link/evil.js", "../widgets/bad/x.js"} {
		if err := hook(&widgetBlock{Info: `src="` + src + `" title="T"`}); err == nil {
			t.Errorf("want an error for src %s", src)
		}
	}
}
