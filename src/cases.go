package main

import (
	"fmt"
	"html"
	"strings"

	"github.com/yuin/goldmark/ast"
)

// A ```cases fence is a set of case cards: what was asked, the key, and
// what each model answered, right ones and wrong ones apart by color and by
// a ✓ or ✗ that survives without CSS (feed readers).
//
//	```cases title="…"
//	## ALLVB_2121 电影 · 2 h
//	tag: 看错了
//	image: ../images/thumb.jpg
//	q: What colour is the shirt?
//	答案 | ok | (E) purple
//	Claude Opus 5.5 | bad | (C) red
//	Glance | note | P(t) 0.97 at 7:00
//
// "## " starts a card (first word in mono); tag, image and q are optional.
var caseAttributes = []string{"title", "note"}

// caseMarks are the row kinds and the sign each shows.
var caseMarks = map[string]string{"ok": "✓", "bad": "✗", "note": "·"}

func caseImage(line string) string {
	if key, value, ok := strings.Cut(strings.TrimSpace(line), ":"); ok && key == "image" {
		return strings.TrimSpace(value)
	}
	return ""
}

type caseCard struct {
	id, rest, tag, q string
	image            *ast.Image
	rows             [][]string
}

func (c *caseCard) html(b *strings.Builder) {
	class := "case"
	if c.image != nil {
		class += " with-image"
	}
	fmt.Fprintf(b, `<article class="%s">`, class)
	if c.image != nil {
		fmt.Fprintf(b, `<div class="case-image">%s</div>`, imageTag(c.image, strings.TrimSpace(c.id+" "+c.rest), "112px"))
	}
	fmt.Fprintf(b, `<div class="case-body"><p class="case-head"><span class="key">%s</span><span>%s</span>`, html.EscapeString(c.id), html.EscapeString(c.rest))
	if c.tag != "" {
		fmt.Fprintf(b, `<em class="case-tag">%s</em>`, html.EscapeString(c.tag))
	}
	b.WriteString("</p>")
	if c.q != "" {
		fmt.Fprintf(b, `<p class="case-q">%s</p>`, html.EscapeString(c.q))
	}
	b.WriteString(`<dl class="case-rows">`)
	for _, row := range c.rows {
		fmt.Fprintf(b, `<div class="%s"><dt>%s</dt><dd><i>%s</i>%s</dd></div>`, row[1], html.EscapeString(row[0]), caseMarks[row[1]], html.EscapeString(row[2]))
	}
	b.WriteString("</dl></div></article>")
}

func renderCases(info string, lines []string, images []*ast.Image) (string, error) {
	attrs, err := blockAttributes(info, caseAttributes)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(attrs["title"]) == "" {
		return "", fmt.Errorf("needs a title")
	}
	var cards []*caseCard
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "## ") {
			id, rest, _ := strings.Cut(strings.TrimSpace(line[3:]), " ")
			cards = append(cards, &caseCard{id: id, rest: strings.TrimSpace(rest)})
			continue
		}
		if len(cards) == 0 {
			return "", fmt.Errorf("%q: start each case with a \"## \" line", line)
		}
		card := cards[len(cards)-1]
		key, value, _ := strings.Cut(line, ":")
		switch key = strings.TrimSpace(key); {
		case !strings.Contains(line, "|") && key == "q":
			card.q = strings.TrimSpace(value)
		case !strings.Contains(line, "|") && key == "tag":
			card.tag = strings.TrimSpace(value)
		case caseImage(line) != "":
			if card.image != nil {
				return "", fmt.Errorf("%q: a case has one image", line)
			}
			card.image, images = images[0], images[1:]
		default:
			cells := dataCells(line)
			if len(cells) != 3 || caseMarks[cells[1]] == "" || cells[0] == "" {
				return "", fmt.Errorf("%q: write who | ok, bad or note | answer, or q:, tag:, image:", line)
			}
			card.rows = append(card.rows, cells)
		}
	}
	if len(cards) == 0 {
		return "", fmt.Errorf("no cases; start each with a \"## \" line")
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<figure class="cases"><figcaption>%s</figcaption><div class="case-list">`, html.EscapeString(attrs["title"]))
	for _, card := range cards {
		if len(card.rows) == 0 {
			return "", fmt.Errorf("case %q has no who | ok, bad or note | answer rows", card.id)
		}
		card.html(&b)
	}
	b.WriteString("</div>")
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="figure-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
