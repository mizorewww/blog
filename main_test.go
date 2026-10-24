package main

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostValidation(t *testing.T) {
	for _, tc := range []struct {
		name, input string
		valid       bool
	}{
		{"valid", "{\"title\":\"A\",\"description\":\"B\",\"date\":\"2026-10-02\"}\n---\n## 内容\n<script>alert(1)</script>\n[bad](javascript:alert(1))", true},
		{"bad-date", "{\"title\":\"A\",\"description\":\"B\",\"date\":\"2026-02-30\"}\n---\nHello", false},
		{"missing-title", "{\"description\":\"B\",\"date\":\"2026-10-02\"}\n---\nHello", false},
		{"bad-metadata", "not json\n---\nHello", false},
		{"no-metadata", "Hello", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), tc.name+".md")
			if err := os.WriteFile(path, []byte(tc.input), 0600); err != nil {
				t.Fatal(err)
			}
			p, err := readPost(path)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if tc.valid && (strings.Contains(string(p.Content), "<script>") || strings.Contains(string(p.Content), "href=\"javascript:")) {
				t.Fatal("unsafe HTML rendered")
			}
		})
	}
}

func TestBuild(t *testing.T) {
	// Work in a disposable fixture; do not replace local preview output.
	dir := t.TempDir()
	for _, name := range []string{"templates", "static", "content"} {
		if err := os.CopyFS(filepath.Join(dir, name), os.DirFS(name)); err != nil {
			t.Fatal(err)
		}
	}
	config, err := os.ReadFile("site.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "site.json"), config, 0600); err != nil {
		t.Fatal(err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	if err = os.WriteFile("static/photo.svg", []byte("<svg/>"), 0644); err != nil {
		t.Fatal(err)
	}
	if err = build("https://example.com/notes"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat("public/static/photo.svg"); err != nil {
		t.Fatal("author-linked assets must retain their path:", err)
	}
	version, err := assetVersion("static")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat("public/static/" + version + "/fonts/fonts.css"); err != nil {
		t.Fatal(err)
	}
	headers, _ := os.ReadFile("public/_headers")
	if !strings.Contains(string(headers), "/notes/static/"+version+"/*") {
		t.Fatal("deployment cache rules must include the base path and content version")
	}
	for _, name := range []string{"index.html", "about/index.html", "posts/less-but-better/index.html", "404.html"} {
		b, err := os.ReadFile(filepath.Join("public", name))
		if err != nil {
			t.Fatal(err)
		}
		html := string(b)
		if strings.Contains(html, "<script") || !strings.Contains(html, `/style.css"`) || !strings.Contains(html, `href="/notes/static/`) || !strings.Contains(html, `<main id="main">`) {
			t.Fatalf("invalid static page %s", name)
		}
	}
	for _, tc := range []struct{ slug, previous, next string }{
		{"a-few-links", "/notes/posts/less-but-better/", ""},
		{"less-but-better", "/notes/posts/plain-text-first/", "/notes/posts/a-few-links/"},
		{"plain-text-first", "", "/notes/posts/less-but-better/"},
	} {
		b, err := os.ReadFile("public/posts/" + tc.slug + "/index.html")
		if err != nil {
			t.Fatal(err)
		}
		html := string(b)
		for rel, target := range map[string]string{"prev": tc.previous, "next": tc.next} {
			if target == "" && strings.Contains(html, `rel="`+rel+`"`) {
				t.Fatalf("unexpected %s on %s", rel, tc.slug)
			}
			if target != "" && !strings.Contains(html, `rel="`+rel+`" href="`+target+`"`) {
				t.Fatalf("missing %s on %s", rel, tc.slug)
			}
		}
		if strings.Contains(html, `class="byline"`) || strings.Contains(html, "分钟阅读") {
			t.Fatal("article has redundant metadata")
		}
	}
	var rss Feed
	b, _ := os.ReadFile("public/feed.xml")
	if err = xml.Unmarshal(b, &rss); err != nil || len(rss.Channel.Items) != 3 {
		t.Fatalf("invalid RSS: %v", err)
	}
	if !strings.Contains(rss.Channel.Items[0].Description, "<h2") {
		t.Fatal("RSS must include full content")
	}
	var sitemap Sitemap
	b, _ = os.ReadFile("public/sitemap.xml")
	if err = xml.Unmarshal(b, &sitemap); err != nil || len(sitemap.URLs) != 5 {
		t.Fatalf("invalid sitemap: %v", err)
	}
	if err = os.WriteFile("public/stale.html", []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = build("https://example.com/notes"); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat("public/stale.html"); !os.IsNotExist(err) {
		t.Fatal("stale output survived rebuild")
	}
	for _, slug := range []string{"a-few-links", "plain-text-first"} {
		if err = os.Remove("content/posts/" + slug + ".md"); err != nil {
			t.Fatal(err)
		}
	}
	if err = build("https://example.com/notes"); err != nil {
		t.Fatal(err)
	}
	single, _ := os.ReadFile("public/posts/less-but-better/index.html")
	if strings.Contains(string(single), "post-pagination") {
		t.Fatal("single article should have no adjacent navigation")
	}
	before, _ := os.ReadFile("public/index.html")
	original, _ := os.ReadFile("content/posts/less-but-better.md")
	if err = os.WriteFile("content/posts/less-but-better.md", append(original, []byte("\n![missing](../images/missing.png)\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	if err = build("https://example.com/notes"); err == nil {
		t.Fatal("missing image should fail build")
	}
	unchanged, _ := os.ReadFile("public/index.html")
	if string(before) != string(unchanged) {
		t.Fatal("missing image damaged previous output")
	}
	if err = os.WriteFile("content/posts/less-but-better.md", original, 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile("content/posts/broken.md", []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = build("https://example.com/notes"); err == nil {
		t.Fatal("invalid content should fail build")
	}
	after, _ := os.ReadFile("public/index.html")
	if string(before) != string(after) {
		t.Fatal("failed build changed previous output")
	}
}

func TestTableOfContents(t *testing.T) {
	body, toc, err := renderContent([]byte("## 中文标题\n\n### A **bold** `code` heading\n\n## 中文标题\n\n```md\n## not a heading\n```\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(toc) != 3 {
		t.Fatalf("unexpected TOC: %+v", toc)
	}
	seen := map[string]bool{}
	for _, h := range toc {
		if h.ID == "" || seen[h.ID] || !strings.Contains(string(body), `id="`+h.ID+`"`) {
			t.Fatalf("invalid heading target: %+v", h)
		}
		seen[h.ID] = true
	}
	if toc[1].Title != "A bold code heading" || toc[1].Level != 3 {
		t.Fatalf("invalid inline heading: %+v", toc[1])
	}
	if toc[0].ID != "中文标题" || toc[1].ID != "a-bold-code-heading" || toc[2].ID != "中文标题-1" {
		t.Fatalf("anchors must stay readable: %+v", toc)
	}
	_, toc, err = renderContent([]byte("Just a paragraph."))
	if err != nil || len(toc) != 0 {
		t.Fatal("heading-free content should have no TOC")
	}
}

func TestCodeHighlighting(t *testing.T) {
	body, _, err := renderContent([]byte("```go\nfunc main() { return }\n```\n\n```nosuchlang\n<b>x</b>\n```\n"))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	if !strings.Contains(html, `<pre tabindex="0" class="chroma">`) || !strings.Contains(html, `<span class="kd">func</span>`) {
		t.Fatalf("known languages must be highlighted with classes and stay focusable: %s", html)
	}
	if strings.Contains(html, "style=") || !strings.Contains(html, `<pre tabindex="0"><code class="language-nosuchlang">&lt;b&gt;`) {
		t.Fatalf("unknown languages must stay plain and escaped: %s", html)
	}
}
