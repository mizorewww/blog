package main

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// fontRules are the style.css rules that choose a font family or weight.
// faceFor in fonts.go mirrors them to subset each page's fonts; when one
// changes, update faceFor to match and then this list.
var fontRules = []string{
	`:root { font-family:var(--sans) }`,
	`button { font:inherit }`,
	`h1,.post-summary h2,.prose h2,.prose h3,.intro,.post-pagination a { font-family:var(--serif); font-weight:400 }`,
	`.brand { font-family:var(--serif) }`,
	`.site-header nav { font-family:var(--mono) }`,
	`.profile { font-family:var(--mono) }`,
	`.cats sup,.term-list span,.term-cloud span { font-family:var(--mono) }`,
	`.post-meta { font-family:var(--mono) }`,
	`.post-summary h2 { font-weight:500 }`,
	`.tags { font-family:var(--mono) }`,
	`.post-summary .snippet { font-family:var(--cjk),"Blog Search","PingFang SC",sans-serif }`,
	`.search-form input { font:16px/1.4 "Maple Mono",var(--cjk),"Blog Search",sans-serif }`,
	`.search-status { font-family:"Maple Mono",var(--cjk),"Blog Search",monospace }`,
	`.terms h2 { font-family:var(--mono); font-weight:400 }`,
	`.term-cloud { font-family:var(--mono) }`,
	`.article-meta { font-family:var(--mono) }`,
	`.article-header h1 { font-weight:500 }`,
	`.prose :is(h2,h3) { font-weight:600 }`,
	`.prose strong { font-weight:500 }`,
	`.prose ol>li::marker { font-family:var(--mono) }`,
	`.prose code { font-family:var(--mono) }`,
	`.code>.code-tools { font-family:var(--mono) }`,
	`.copy { font-family:var(--mono) }`,
	`.code figcaption { font-family:var(--mono) }`,
	`.code-path b { font-weight:400 }`,
	`.code-path span { font-family:var(--sans) }`,
	`.prose th { font-weight:500 }`,
	`:is(.data,.chart,.stats) figcaption { font-family:var(--serif); font-weight:600 }`,
	`.data table { font-family:var(--mono) }`,
	`.data th { font-weight:400 }`,
	`.data td:first-child { font-family:var(--sans) }`,
	`.data tr.mark td { font-weight:500 }`,
	`.key { font-family:var(--mono); font-weight:400 }`,
	`.plot span { font-family:var(--mono) }`,
	`.plot .dl { font-weight:500 }`,
	`.tip>div { font-family:var(--mono) }`,
	`.tip b { font-weight:400 }`,
	`.stats-group { font-family:var(--mono) }`,
	`.stats-group b { font-weight:500 }`,
	`.kpi dd { font-family:var(--mono); font-weight:500 }`,
	`.kpi dd.s { font-weight:400 }`,
	`.ticker b { font-family:var(--mono); font-weight:500 }`,
	`.ticker-go { font-family:var(--mono) }`,
	`.toc,.toc-mobile { font-family:var(--mono) }`,
	`.colophon dt { font-family:var(--mono) }`,
	`.colophon code,.colophon time { font-family:var(--mono) }`,
	`.to-top { font-family:var(--mono) }`,
	`.post-pagination span { font-family:var(--mono) }`,
	`.site-footer { font-family:var(--mono) }`,
}

var (
	cssComment     = regexp.MustCompile(`(?s)/\*.*?\*/`)
	cssRule        = regexp.MustCompile(`([^{}]+)\{([^{}]*)\}`)
	cssFontSetting = regexp.MustCompile(`^\s*(font-family|font-weight|font)\s*:`)
)

func TestFontRulesMatchFaceFor(t *testing.T) {
	css, err := os.ReadFile("static/style.css")
	if err != nil {
		t.Fatal(err)
	}
	var rules []string
	for _, m := range cssRule.FindAllStringSubmatch(cssComment.ReplaceAllString(string(css), ""), -1) {
		selector := strings.TrimSpace(m[1])
		var settings []string
		for _, declaration := range strings.Split(m[2], ";") {
			if cssFontSetting.MatchString(declaration) {
				settings = append(settings, strings.TrimSpace(declaration))
			}
		}
		if len(settings) > 0 && !strings.HasPrefix(selector, "@font-face") {
			rules = append(rules, selector+" { "+strings.Join(settings, "; ")+" }")
		}
	}
	if !slices.Equal(rules, fontRules) {
		for _, r := range rules {
			if !slices.Contains(fontRules, r) {
				t.Errorf("new or changed in style.css: %s", r)
			}
		}
		for _, r := range fontRules {
			if !slices.Contains(rules, r) {
				t.Errorf("gone from style.css: %s", r)
			}
		}
		t.Fatal("style.css font rules changed: update faceFor in fonts.go, then fontRules")
	}
}

func TestFaceFor(t *testing.T) {
	el := func(tag string, class ...string) textElement { return textElement{tag, class} }
	for _, tc := range []struct {
		stack []textElement
		want  int
	}{
		{[]textElement{el("p")}, sans400},
		{[]textElement{el("div", "prose"), el("p"), el("strong")}, sans500},
		{[]textElement{el("div", "prose"), el("h2")}, serif600},
		{[]textElement{el("header", "article-header"), el("h1")}, serif500},
		{[]textElement{el("div", "post-summary"), el("h2"), el("a")}, serif500},
		{[]textElement{el("a", "brand")}, serif400},
		{[]textElement{el("figure", "data"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "data"), el("figcaption"), el("span", "key")}, sans400},
		{[]textElement{el("nav", "post-pagination"), el("a")}, serif400},
		{[]textElement{el("nav", "post-pagination"), el("a"), el("span")}, sans400},
		{[]textElement{el("figure", "data"), el("table"), el("tr", "mark"), el("td")}, sans500},
	} {
		if got := faceFor(tc.stack); got != tc.want {
			t.Errorf("faceFor(%v) = %d, want %d", tc.stack, got, tc.want)
		}
	}
}
