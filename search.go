package main

import (
	"encoding/json"
	"strings"

	"golang.org/x/net/html"
)

// contentText is the readable text of rendered HTML, for the search index.
func contentText(content string) string {
	var b strings.Builder
	skip := 0
	z := html.NewTokenizer(strings.NewReader(content))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return strings.Join(strings.Fields(b.String()), " ")
		case html.StartTagToken:
			if name, _ := z.TagName(); string(name) == "svg" || string(name) == "math" || string(name) == "button" {
				skip++
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); skip > 0 && (string(name) == "svg" || string(name) == "math" || string(name) == "button") {
				skip--
			}
		case html.TextToken:
			if skip == 0 {
				b.Write(z.Text())
				b.WriteByte(' ')
			}
		}
	}
}

// writeSearch writes the search page and the index its script fetches on first use.
func (b *builder) writeSearch(e *edition) error {
	type entry struct {
		Title string `json:"t"`
		Text  string `json:"x"`
	}
	index := map[string]entry{}
	var corpus strings.Builder
	for _, p := range e.posts {
		words := append([]string{p.Title, p.Description, p.Tag}, p.Tags...)
		text := contentText(string(p.Content))
		index[p.Path] = entry{strings.Join(words, " "), text}
		corpus.WriteString(text)
	}
	corpus.WriteString(e.lang.UI.SearchFound + e.lang.UI.SearchNone)
	data, err := json.Marshal(index)
	if err != nil {
		return err
	}
	if err = b.write(strings.TrimPrefix(e.lang.Base+"/search.json", "/"), data); err != nil {
		return err
	}
	// Snippets appear only after a search, so their glyphs get a font of their own.
	return b.page(e.lang.Base+"/search/", Page{Lang: e.lang, Title: e.lang.UI.Search + " — " + b.site.Title, Description: e.lang.UI.SearchLabel, Kind: "search", Posts: e.posts, Switch: b.switchTo(e, "/search/")}, corpus.String())
}
