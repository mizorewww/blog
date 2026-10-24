package main

import (
	"encoding/json"
	"encoding/xml"
	"github.com/yuin/goldmark/ast"
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
		{"updated", "{\"title\":\"A\",\"description\":\"B\",\"date\":\"2026-10-02\",\"updated\":\"2026-10-20\"}\n---\nHello", true},
		{"updated-before-date", "{\"title\":\"A\",\"description\":\"B\",\"date\":\"2026-10-02\",\"updated\":\"2026-10-01\"}\n---\nHello", false},
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
	for _, name := range []string{"templates", "static", "fonts"} {
		if err := os.CopyFS(filepath.Join(dir, name), os.DirFS(name)); err != nil {
			t.Fatal(err)
		}
	}
	// Fixture posts keep the test independent of real articles and their images.
	fixtures := map[string]string{
		"content/posts/alpha.md": "{\"title\":\"Alpha\",\"description\":\"A\",\"date\":\"2026-10-02\"}\n---\n## 第一节\n\n正文。\n",
		"content/posts/beta.md":  "{\"title\":\"Beta\",\"description\":\"B\",\"date\":\"2026-10-02\"}\n---\n正文。\n",
		"content/posts/gamma.md": "{\"title\":\"Gamma\",\"description\":\"C\",\"date\":\"2026-09-28\"}\n---\n正文。\n",
	}
	for name, body := range fixtures {
		if err := os.MkdirAll(filepath.Join(dir, filepath.Dir(name)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
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
	lateFonts, _ := filepath.Glob("public/static/" + version + "/fonts/sans-400-*.woff2")
	if len(lateFonts) == 0 {
		t.Fatal("pages need their late font subsets")
	}
	headers, _ := os.ReadFile("public/_headers")
	if !strings.Contains(string(headers), "/notes/static/"+version+"/*") || !strings.Contains(string(headers), "/notes/images/*\n  Cache-Control: public, max-age=31536000, immutable") {
		t.Fatal("deployment cache rules must include the base path and content version")
	}
	for _, name := range []string{"index.html", "posts/beta/index.html", "404.html"} {
		b, err := os.ReadFile(filepath.Join("public", name))
		if err != nil {
			t.Fatal(err)
		}
		html := string(b)
		if strings.Count(html, "<script") > strings.Count(html, `<script type="application/ld+json">`)+1 || !strings.Contains(html, `<style>@font-face`) || !strings.Contains(html, `url("/notes/static/`+version+`/fonts/`) || !strings.Contains(html, `href="/notes/static/`) || !strings.Contains(html, `<main id="main">`) || !strings.Contains(html, `<a href="https://about.mizore.blog" rel="me">关于`) {
			t.Fatalf("invalid static page %s", name)
		}
	}
	for _, tc := range []struct{ slug, previous, next string }{
		{"alpha", "/notes/posts/beta/", ""},
		{"beta", "/notes/posts/gamma/", "/notes/posts/alpha/"},
		{"gamma", "", "/notes/posts/beta/"},
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
		if !strings.Contains(html, `<p class="article-meta">`) || !strings.Contains(html, "分钟阅读") || strings.Count(html, `aria-label="文章目录"`) > 2 {
			t.Fatalf("article metadata is missing on %s", tc.slug)
		}
	}
	var rss Feed
	b, _ := os.ReadFile("public/feed.xml")
	if err = xml.Unmarshal(b, &rss); err != nil || len(rss.Channel.Items) != 3 {
		t.Fatalf("invalid RSS: %v", err)
	}
	// encoding/xml lets the Atom <link> shadow the RSS one when decoding, so check the text.
	for _, want := range []string{"<link>https://example.com/notes/</link>", `<link xmlns="http://www.w3.org/2005/Atom" href="https://example.com/notes/feed.xml" rel="self" type="application/rss+xml"></link>`, "<language>zh-CN</language>"} {
		if !strings.Contains(string(b), want) {
			t.Fatalf("RSS channel lacks %s", want)
		}
	}
	if !strings.Contains(rss.Channel.Items[0].Description, "<h2") {
		t.Fatal("RSS must include full content")
	}
	var sitemap Sitemap
	b, _ = os.ReadFile("public/sitemap.xml")
	if err = xml.Unmarshal(b, &sitemap); err != nil || len(sitemap.URLs) != 4 {
		t.Fatalf("invalid sitemap: %v", err)
	}
	for _, u := range sitemap.URLs {
		if u.LastMod != "2026-10-02" && u.LastMod != "2026-09-28" {
			t.Fatalf("sitemap lastmod must come from post dates: %+v", u)
		}
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
	for _, slug := range []string{"alpha", "gamma"} {
		if err = os.Remove("content/posts/" + slug + ".md"); err != nil {
			t.Fatal(err)
		}
	}
	if err = build("https://example.com/notes"); err != nil {
		t.Fatal(err)
	}
	single, _ := os.ReadFile("public/posts/beta/index.html")
	if strings.Contains(string(single), `class="post-pagination"`) {
		t.Fatal("single article should have no adjacent navigation")
	}
	before, _ := os.ReadFile("public/index.html")
	original, _ := os.ReadFile("content/posts/beta.md")
	if err = os.WriteFile("content/posts/beta.md", append(original, []byte("\n![missing](../images/missing.png)\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	if err = build("https://example.com/notes"); err == nil {
		t.Fatal("missing image should fail build")
	}
	unchanged, _ := os.ReadFile("public/index.html")
	if string(before) != string(unchanged) {
		t.Fatal("missing image damaged previous output")
	}
	if err = os.WriteFile("content/posts/beta.md", original, 0600); err != nil {
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
	if strings.Contains(html, "style=") || !strings.Contains(html, `<code>&lt;b&gt;x&lt;/b&gt;</code>`) || !strings.Contains(html, `<span class="lang">go</span>`) {
		t.Fatalf("unknown languages must stay plain and escaped, with the language named: %s", html)
	}
	body, _, err = renderContent([]byte("```go src=\"https://github.com/o/r/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/a/b.go#L76-L77\" title=\"T\"\nx := 1\ny := 2\n```\n"))
	if err != nil {
		t.Fatal(err)
	}
	if html = string(body); !strings.Contains(html, `<b>a/b.go</b><span>T</span>`) || !strings.Contains(html, `L76–77 · ad8012c ↗`) || !strings.Contains(html, `>77</span>`) || strings.Contains(html, `class="lang"`) {
		t.Fatalf("source quotes need a path header and their own line numbers: %s", html)
	}
	if _, _, err = renderContent([]byte("```go src=\"https://example.com/a.go\"\nx\n```\n")); err == nil {
		t.Fatal("src must be a GitHub permalink")
	}
}

func TestBlocks(t *testing.T) {
	src := "```chart line title=\"累计\"\n周五 | BTC | ETH\n2023-12-29 | 0.1 | -0.2\n2024-01-05 | 0.3 | 0.1\n```\n\n" +
		"```chart bar mirror=\"true\"\n区间 | A | B\n0 | 3 | 1\n1 | 5 | 2\n```\n\n" +
		"```chart scatter diag=\"true\" mark=\"p\"\n点 | x | y\np | -0.05 | -0.09\nq | 0.01 | 0.01\n```\n\n" +
		"```stats title=\"S\"\n## BTC 单利\n总收益 | +1.1 | 说明\n回撤 | -0.1\n```\n\n::tv BINANCE:BTCUSDT 比特币 height=420\n"
	body, _, err := renderContent([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{`<svg viewBox="0 0 664`, `role="img" aria-label="累计"`, `>2024</span>`, `BTC 0.3</span>`, `ETH 0.1</span>`, `A ↑</span>`, `>p</span>`,
		`<p class="stats-group"><b>BTC</b>单利</p>`, `<dd class="up">+1.1</dd><dd class="s">说明</dd>`, `<dd>−0.1</dd>`,
		`<a class="ticker" href="https://www.tradingview.com/symbols/BINANCE-BTCUSDT/"><span><b>BINANCE:BTCUSDT</b><span class="ticker-label">比特币</span>`} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	for _, bad := range []string{"```chart pie\nx | y\n1 | 2\n```\n", "```chart line\nx\n1\n```\n", "```chart scatter\n点 | x | y\np | a | 1\n```\n", "```stats\n## A\n```\n"} {
		if _, _, err := renderContent([]byte(bad)); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
}

func TestMath(t *testing.T) {
	body, _, err := renderContent([]byte("面积 $\\pi r^2$ 与 $$f(h) = (1-h)$$。\n\n$$\n\\frac{a}{b}\n$$\n\n价格 $0.0028/$0.14，$5 和 $10，`$x$`，\\$y$。\n"))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{`<span class="math-inline"><math`, `display="inline"`, `<div class="math" tabindex="0"><math`, `display="block"`, "<mfrac>", "价格 $0.0028/$0.14，$5 和 $10，<code>$x$</code>，$y$。"} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %q in %s", want, html)
		}
	}
	if strings.Count(html, "<math") != 3 || strings.Contains(html, "\n  ") {
		t.Fatalf("expected three compact formulas: %s", html)
	}
	if _, _, err = renderContent([]byte("$\\arg x$")); err == nil {
		t.Fatal("unsupported LaTeX must fail the build")
	}
}

func TestDataTable(t *testing.T) {
	body, _, err := renderContent([]byte("```data title=\"Sharpe <x>\" bars=\"BTC\" mark=\"Δ0.35\" note=\"周频\"\nDelta | BTC | 说明\n--- | ---: | ---\nΔ0.05 | −1.00 | <b>\nΔ0.35 | 3.00 | —\n```\n"))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{
		`<figcaption>Sharpe &lt;x&gt;</figcaption>`,
		`<th class="num">BTC</th><th>说明</th>`,
		`<td class="num bar neg" style="--a:0.0%;--b:25.0%;--z:25.0%">−1.00</td><td>&lt;b&gt;</td>`,
		`<tr class="mark"><td>Δ0.35</td><td class="num bar" style="--a:25.0%;--b:100.0%;--z:25.0%">3.00</td>`,
		`<p class="data-note">周频</p>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %q in %s", want, html)
		}
	}
	shared, _, _ := renderContent([]byte("```data bars=\"A,B\"\nx | A | B\na | 1 | 4\n```\n"))
	column, _, _ := renderContent([]byte("```data bars=\"A,B\" scale=\"column\"\nx | A | B\na | 1 | 4\n```\n"))
	if !strings.Contains(string(shared), `--b:25.0%">1</td>`) || !strings.Contains(string(column), `--b:100.0%">1</td>`) {
		t.Fatalf("bars must share a scale unless scale=column: %s %s", shared, column)
	}
	for _, bad := range []string{
		"```data colour=\"red\"\na | b\n1 | 2\n```",
		"```data bars=\"C\"\na | b\n1 | 2\n```",
		"```data\na | b\n1\n```",
		"```data\na | b\n```",
	} {
		if _, _, err := renderContent([]byte(bad)); err == nil {
			t.Fatalf("invalid data table must fail the build: %s", bad)
		}
	}
}

func TestReadingUnits(t *testing.T) {
	if n := readingUnits("中文字 and English words\n\n```go\nfunc ignored() {}\n```\n\n2026 年"); n != 3+3+1+1 {
		t.Fatalf("got %d units", n)
	}
}

func TestStructuredData(t *testing.T) {
	site := Site{Title: "T", Author: "A", URL: "https://example.com", About: "https://about.example.com", SameAs: []string{"https://github.com/a"}}
	post := &Post{PostMetadata: PostMetadata{Title: "</script><b>", Description: "D", Date: "2026-10-02", Updated: "2026-10-20", Tag: "x"}, Path: "/posts/p/"}
	ld := string(structuredData(Page{Site: site, Kind: "post", Post: post, Image: defaultShareImage(site)}))
	if strings.Contains(ld, "</script>") {
		t.Fatal("JSON-LD must not close its script element")
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(ld), &data); err != nil {
		t.Fatal(err)
	}
	if data["@type"] != "BlogPosting" || data["headline"] != "</script><b>" || data["dateModified"] != "2026-10-20" || data["image"] != "https://example.com/static/og.png" || data["author"].(map[string]any)["url"] != "https://about.example.com" {
		t.Fatalf("unexpected JSON-LD: %v", data)
	}
	if structuredData(Page{Site: site, Kind: "404"}) != "" {
		t.Fatal("404 pages carry no structured data")
	}
}

func TestFirstImage(t *testing.T) {
	var share ShareImage
	src := []byte("![a **photo**](a.png)\n\n![second](b.png)\n")
	hook := firstImage(func(n *ast.Image) error {
		n.Destination = append([]byte("https://example.com/images/"), n.Destination...)
		n.SetAttributeString("width", "1600")
		n.SetAttributeString("height", "1200")
		return nil
	}, src, &share)
	if _, _, err := renderContent(src, hook); err != nil {
		t.Fatal(err)
	}
	if share != (ShareImage{URL: "https://example.com/images/a.png", Alt: "a photo", Width: 1600, Height: 1200}) {
		t.Fatalf("unexpected share image: %+v", share)
	}
}

func TestRedirects(t *testing.T) {
	files := map[string]string{}
	write := func(name string, body []byte) error { files[filepath.ToSlash(name)] = string(body); return nil }
	site := Site{URL: "https://example.com/notes", Redirects: []Redirect{{"/zh/*", "/"}, {"/about/", "https://about.example.com"}}}
	posts := []Post{{PostMetadata: PostMetadata{Title: "T", Aliases: []string{"/zh/技术/x/"}}, Slug: "x", Path: "/posts/x/"}}
	if err := writeRedirects(site, "/notes", posts, write); err != nil {
		t.Fatal(err)
	}
	want := "/notes/zh/%E6%8A%80%E6%9C%AF/x/ /notes/posts/x/ 301\n/notes/zh/%E6%8A%80%E6%9C%AF/x /notes/posts/x/ 301\n" +
		"/notes/zh/技术/x/ /notes/posts/x/ 301\n/notes/zh/技术/x /notes/posts/x/ 301\n" +
		"/notes/zh/* /notes/ 301\n/notes/about/ https://about.example.com 301\n"
	if files["_redirects"] != want {
		t.Fatalf("unexpected _redirects:\n%s", files["_redirects"])
	}
	if page := files["zh/技术/x/index.html"]; !strings.Contains(page, `content="0; url=https://example.com/notes/posts/x/"`) || !strings.Contains(page, `rel="canonical" href="https://example.com/notes/posts/x/"`) || !strings.Contains(page, "noindex") {
		t.Fatalf("missing fallback page: %q", page)
	}
	for _, bad := range [][]string{{"zh/x/"}, {"/zh/x"}, {"/zh/../x/"}, {"/posts/y/"}, {"/"}, {"/a/", "/a/"}} {
		p := posts[0]
		p.Aliases = bad
		if err := writeRedirects(site, "", []Post{p}, write); err == nil {
			t.Fatalf("alias %v must be rejected", bad)
		}
	}
}
