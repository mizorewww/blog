package main

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// Term is a category or tag with the posts filed under it.
type Term struct {
	Name, Slug, Path string
	Lang             *Lang
	Posts            []*Post
	Translation      *Term
}

// termSlug matches the old blog's github-slugger URLs: lowercase, spaces to
// hyphens, punctuation other than - and _ dropped, letters of any script kept.
func termSlug(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) || r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('-')
		}
	}
	return b.String()
}

// collectTerms groups posts (newest first) by name; terms sort by post count, then name.
// Two different names with one slug would share a page, so they fail the build.
func collectTerms(posts []*Post, base, kind string, names func(*Post) []string) ([]*Term, error) {
	bySlug := map[string]*Term{}
	var terms []*Term
	for _, p := range posts {
		for _, name := range names(p) {
			slug := termSlug(name)
			if slug == "" {
				continue
			}
			t := bySlug[slug]
			if t == nil {
				t = &Term{Name: name, Slug: slug, Path: base + "/" + kind + "/" + slug + "/"}
				bySlug[slug] = t
				terms = append(terms, t)
			} else if t.Name != name {
				return nil, fmt.Errorf("%s: %s %q and %q share the URL %s; use one spelling", p.File, kind, name, t.Name, t.Path)
			}
			if len(t.Posts) == 0 || t.Posts[len(t.Posts)-1] != p {
				t.Posts = append(t.Posts, p)
			}
		}
	}
	sort.SliceStable(terms, func(i, j int) bool {
		if len(terms[i].Posts) != len(terms[j].Posts) {
			return len(terms[i].Posts) > len(terms[j].Posts)
		}
		return terms[i].Slug < terms[j].Slug
	})
	return terms, nil
}

// indexTerms files the edition's posts under categories and tags.
func (b *builder) indexTerms(e *edition) error {
	var err error
	if e.categories, err = collectTerms(e.posts, e.lang.Base, "categories", func(p *Post) []string { return []string{p.Tag} }); err != nil {
		return err
	}
	if e.tags, err = collectTerms(e.posts, e.lang.Base, "tags", func(p *Post) []string { return p.Tags }); err != nil {
		return err
	}
	for _, c := range e.categories {
		c.Lang = e.lang
	}
	for _, t := range e.tags {
		t.Lang = e.lang
	}
	units, minutes := 0, 0
	for _, p := range e.posts {
		units += p.Units
		minutes += p.Minutes
		for _, c := range e.categories {
			if c.Slug == termSlug(p.Tag) {
				p.Category = c
			}
		}
		for _, name := range p.Tags {
			for _, t := range e.tags {
				if t.Slug == termSlug(name) && !slices.Contains(p.Terms, t) {
					p.Terms = append(p.Terms, t)
				}
			}
		}
	}
	e.stats = fmt.Sprintf(e.lang.UI.Stats, len(e.posts), len(e.categories), len(e.tags), wordCount(e.lang, units))
	if len(e.posts) > 0 {
		wordsVal, wordsUnit := splitWordCount(e.lang, units)
		newestMonth := strings.ReplaceAll(e.posts[0].Date[:7], "-", ".")
		oldestMonth := strings.ReplaceAll(e.posts[len(e.posts)-1].Date[:7], "-", ".")
		span := newestMonth
		if oldestMonth != newestMonth {
			span = oldestMonth + "–" + newestMonth
		}
		e.dashboard = &Dashboard{
			PostCount:  len(e.posts),
			TagCount:   len(e.tags),
			Minutes:    minutes,
			WordsValue: wordsVal,
			WordsUnit:  wordsUnit,
			Span:       span,
			Latest:     newestOf(e.posts),
		}
	}
	return nil
}

// wordCount abbreviates a reading-unit total the way each language counts.
func wordCount(lang *Lang, units int) string {
	switch {
	case lang.Code == "zh" && units >= 10000:
		return strconv.FormatFloat(float64(units)/10000, 'f', 1, 64) + " 万"
	case lang.Code != "zh" && units >= 1000:
		return strconv.FormatFloat(float64(units)/1000, 'f', 1, 64) + "k"
	}
	return strconv.Itoa(units)
}

// splitWordCount separates the numeric figure and unit suffix for KPI display.
func splitWordCount(lang *Lang, units int) (string, string) {
	switch {
	case lang.Code == "zh" && units >= 10000:
		return strconv.FormatFloat(float64(units)/10000, 'f', 1, 64), lang.UI.WordsWan
	case lang.Code == "zh":
		return strconv.Itoa(units), lang.UI.WordsChar
	case units >= 1000:
		return strconv.FormatFloat(float64(units)/1000, 'f', 1, 64), "k"
	default:
		return strconv.Itoa(units), ""
	}
}

// linkTerms pairs categories and tags that represent the same page across editions.
func (b *builder) linkTerms() {
	for i, a := range b.editions {
		if !a.published() {
			continue
		}
		for _, o := range b.editions[i+1:] {
			if !o.published() {
				continue
			}
			pairTerms(a.categories, o.categories, true)
			pairTerms(a.tags, o.tags, false)
		}
	}
}

func pairTerms(left, right []*Term, byPosts bool) {
	for _, l := range left {
		for _, r := range right {
			if l.Slug == r.Slug {
				l.Translation, r.Translation = r, l
			}
		}
	}
	if !byPosts {
		return
	}
	for _, l := range left {
		if l.Translation != nil {
			continue
		}
		for _, r := range right {
			if r.Translation == nil && sameTranslatedCategory(l, r) {
				l.Translation, r.Translation = r, l
				break
			}
		}
	}
}

func sameTranslatedCategory(a, b *Term) bool {
	paired := 0
	for _, p := range a.Posts {
		if p.Translation != nil {
			if p.Translation.Category != b {
				return false
			}
			paired++
		}
	}
	for _, q := range b.Posts {
		if q.Translation != nil && q.Translation.Category != a {
			return false
		}
	}
	return paired > 0
}
