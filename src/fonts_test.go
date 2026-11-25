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
	`h1,.post-summary h2,.prose h2,.prose h3,.post-pagination a { font-family:var(--serif); font-weight:400 }`,
	`.brand { font-family:var(--serif) }`,
	`.site-header nav { font-family:var(--mono) }`,
	`.ledger-meta { font-family:var(--mono) }`,
	`.ledger-kpis dd { font-family:var(--mono); font-weight:500 }`,
	`.cat-list span,.term-list span,.term-cloud span { font-family:var(--mono) }`,
	`.about-handle { font-family:var(--mono) }`,
	`.about-section h2 { font-family:var(--mono); font-weight:400 }`,
	`.about-mono { font-family:var(--mono) }`,
	`.about-actions { font-family:var(--mono) }`,
	`.pgp-key { font-family:var(--mono) }`,
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
	`.prose thead th { font-weight:500 }`,
	`.prose :is(td.num,td.date,td.mono-key) { font-family:var(--mono) }`,
	`:is(.data,.chart,.stats) figcaption { font-family:var(--serif); font-weight:600 }`,
	`.data td.row-key { font-weight:500 }`,
	`.num-sub { font-family:var(--sans); font-weight:400 }`,
	`.data tr.mark td { font-weight:500 }`,
	`.key { font-family:var(--mono); font-weight:400 }`,
	`.plot span { font-family:var(--mono) }`,
	`.plot .dl { font-weight:500 }`,
	`.tip>div { font-family:var(--mono) }`,
	`.tip b { font-weight:400 }`,
	`:is(.echart,.diagram,.plotfig,.video,.frames,.cases,.trace,.widget) figcaption { font-family:var(--serif); font-weight:600 }`,
	`:is(.echart,.diagram,.plotfig,.video,.frames,.cases,.trace,.widget) figcaption::before { font-family:var(--mono); font-weight:400 }`,
	`.echart .figure-plot { font-family:var(--mono) }`,
	`.sketch { font-family:var(--sans) }`,
	`.sketch .b { font-weight:500 }`,
	`.sketch .mono { font-family:var(--mono) }`,
	`.sketch .caps { font-family:var(--mono) }`,
	`.plot-title { font-weight:500 }`,
	`.plot-panel svg { font-family:var(--sans) }`,
	`.frames .frames-q { font-family:var(--mono) }`,
	`.frames .frames-p { font-family:var(--mono) }`,
	`.frames-p b { font-weight:400 }`,
	`.cases .case-q { font-weight:500 }`,
	`.case-rows dt { font-family:var(--mono) }`,
	`.prose .trace-log { font-family:var(--mono) }`,
	`.t-user .t-x,.t-say .t-x { font-family:var(--sans) }`,
	`.t-note { font-family:var(--sans) }`,
	`.prose .stats-group,.stats-group { font-family:var(--sans) }`,
	`.stats-group b { font-weight:500 }`,
	`.kpi dd { font-family:var(--mono); font-weight:500 }`,
	`.kpi-u { font-family:var(--sans); font-weight:400 }`,
	`.kpi dd.s { font-family:var(--sans); font-weight:400 }`,
	`.ticker b { font-family:var(--mono); font-weight:500 }`,
	`.ticker-go { font-family:var(--mono) }`,
	`.cards-title { font-family:var(--serif); font-weight:600 }`,
	`.cards-tools { font-family:var(--mono) }`,
	`.prose .anki-title { font-weight:500 }`,
	`.cloze-mask { font-family:var(--mono); font-weight:400 }`,
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
		{[]textElement{el("figure", "data"), el("table"), el("tr"), el("td", "row-key")}, sans500},
		{[]textElement{el("figure", "data"), el("table"), el("tr", "mark"), el("td", "num"), el("span", "num-sub")}, sans400},
		{[]textElement{el("figure", "stats"), el("dl", "kpi"), el("div"), el("dd"), el("span", "kpi-u")}, sans400},
		{[]textElement{el("div", "ledger"), el("dl", "ledger-kpis"), el("div"), el("dd")}, sans500},
		{[]textElement{el("div", "ledger"), el("dl", "ledger-kpis"), el("div"), el("dd"), el("span", "kpi-u")}, sans400},
		{[]textElement{el("header", "about-head"), el("div", "about-title"), el("h1")}, serif400},
		{[]textElement{el("header", "about-head"), el("div", "about-title"), el("span", "about-handle")}, sans400},
		{[]textElement{el("figure", "echart"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "frames"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "cases"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "trace"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "trace"), el("ol", "trace-log"), el("li", "t-ans"), el("span", "t-note")}, sans400},
		{[]textElement{el("figure", "cases"), el("article", "case"), el("p", "case-q")}, sans500},
		{[]textElement{el("figure", "plotfig"), el("div", "plot-grid"), el("div", "plot-panel"), el("p", "plot-title")}, sans500},
		{[]textElement{el("figure", "widget"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "video"), el("figcaption")}, serif600},
		{[]textElement{el("figure", "cases"), el("p", "case-head"), el("span", "key")}, sans400},
		{[]textElement{el("figure", "frames"), el("ol", "frames-strip"), el("li", "in"), el("p", "frames-p"), el("b")}, sans400},
		{[]textElement{el("figure", "diagram"), el("div", "figure-plot"), el("svg", "sketch"), el("text", "b")}, sans500},
		{[]textElement{el("figure", "diagram"), el("div", "figure-plot"), el("svg"), el("text")}, sans400},
		{[]textElement{el("details", "cards-deck"), el("summary", "cards-summary"), el("span", "cards-title")}, serif600},
		{[]textElement{el("div", "prose"), el("details", "cards-deck"), el("article", "anki-card"), el("p", "anki-title")}, sans500},
		{[]textElement{el("div", "prose"), el("p"), el("strong"), el("button", "cloze"), el("span", "cloze-mask")}, sans400},
	} {
		if got := faceFor(tc.stack); got != tc.want {
			t.Errorf("faceFor(%v) = %d, want %d", tc.stack, got, tc.want)
		}
	}
}
