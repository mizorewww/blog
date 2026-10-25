package main

import (
	"html/template"
	"os"
	"path/filepath"
	"strings"
)

// pageScripts are the readable sources in templates/js. A page carries the
// base script plus only the parts its content uses, compacted and inline.
type pageScripts map[string]string

var scriptParts = []string{"base", "tip", "ticker", "toc", "draw", "search"}

func loadScripts() (pageScripts, error) {
	scripts := pageScripts{}
	for _, name := range scriptParts {
		src, err := os.ReadFile(filepath.Join("templates", "js", name+".js"))
		if err != nil {
			return nil, err
		}
		scripts[name] = compactScript(string(src))
	}
	return scripts, nil
}

// compactScript drops indentation, blank lines and whole-line comments. Line
// breaks stay, so the result means exactly what the source says.
func compactScript(src string) string {
	var lines []string
	for _, line := range strings.Split(src, "\n") {
		if line = strings.TrimSpace(line); line != "" && !strings.HasPrefix(line, "//") {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// For is the script of one page, in a block so its names stay local.
func (s pageScripts) For(p Page) template.JS {
	parts := []string{s["base"]}
	if p.Post != nil {
		if strings.Contains(string(p.Post.Content), ` data-tip="`) {
			parts = append(parts, s["tip"])
		}
		if strings.Contains(string(p.Post.Content), `<div class="ticker"`) {
			parts = append(parts, s["ticker"])
		}
		if len(p.Post.TOC) > 0 {
			parts = append(parts, s["toc"])
		}
		if strings.Contains(string(p.Post.Content), "<strong>") {
			parts = append(parts, s["draw"])
		}
	}
	if p.Kind == "search" {
		parts = append(parts, s["search"])
	}
	return template.JS("{\n" + strings.Join(parts, "\n") + "\n}")
}
