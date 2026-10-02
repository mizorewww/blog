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
	if err = build("https://example.com/notes"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"index.html", "about/index.html", "posts/less-but-better/index.html", "404.html"} {
		b, err := os.ReadFile(filepath.Join("public", name))
		if err != nil {
			t.Fatal(err)
		}
		html := string(b)
		if strings.Contains(html, "<script") || !strings.Contains(html, `href="/notes/static/style.css"`) || !strings.Contains(html, `<main id="main">`) {
			t.Fatalf("invalid static page %s", name)
		}
	}
	var rss Feed
	b, _ := os.ReadFile("public/feed.xml")
	if err = xml.Unmarshal(b, &rss); err != nil || len(rss.Channel.Items) != 1 {
		t.Fatalf("invalid RSS: %v", err)
	}
	if !strings.Contains(rss.Channel.Items[0].Description, "<h2") {
		t.Fatal("RSS must include full content")
	}
	var sitemap Sitemap
	b, _ = os.ReadFile("public/sitemap.xml")
	if err = xml.Unmarshal(b, &sitemap); err != nil || len(sitemap.URLs) != 3 {
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
	before, _ := os.ReadFile("public/index.html")
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
