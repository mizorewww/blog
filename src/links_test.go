package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckLinks(t *testing.T) {
	stage := t.TempDir()
	pages := map[string]string{
		"index.html":         `<a href="/notes/posts/a/#intro">a</a><a href="#top" id="top">top</a><img srcset="/notes/images/x.webp 720w, https://example.com/notes/images/x.webp 1600w"><a href="https://other.example/">out</a><a href="/elsewhere/">outside the site</a>`,
		"posts/a/index.html": `<h2 id="intro">Intro</h2><a href="../../">home</a><a href="../../?q=1#top">home query</a><a href="./#intro">self rel</a><a href="../b/#sec">b frag</a><a href="../b/?v=1">b query</a><a href="#intro">self</a>`,
		"posts/b/index.html": `<h2 id="sec">Sec</h2>`,
		"images/x.webp":      "",
	}
	write := func() {
		for name, body := range pages {
			target := filepath.Join(stage, name)
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, []byte(body), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	write()
	if err := checkLinks(stage, "https://example.com/notes", "/notes"); err != nil {
		t.Fatal(err)
	}
	pages["posts/a/index.html"] += `<a href="/notes/posts/gone/">gone</a><a href="#nope">nope</a><a href="/notes/#missing">missing</a><a href="../b/#missing">rel missing</a>`
	write()
	err := checkLinks(stage, "https://example.com/notes", "/notes")
	if err == nil {
		t.Fatal("broken links must fail the build")
	}
	for _, want := range []string{"/notes/posts/gone/", "#nope", "/notes/#missing", "../b/#missing"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("missing %s in %v", want, err)
		}
	}
}
