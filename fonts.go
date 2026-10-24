package main

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/tdewolff/font"
	"golang.org/x/net/html"
)

// Every page carries its own subsets of the CJK faces in fonts/ (made by
// scripts/prepare-fonts.py). What a reader sees first, everything before the
// first section heading, is inlined, so it paints in the right face at once.
// The page's remaining characters go to a small file under a "Late" family
// that the page enables after load (see templates/page.html and style.css).
type pageFace struct {
	file, family string
	weight       int
}

const (
	sans400 = iota
	sans500
	serif400
	serif500
	serif600
)

var pageFaces = []pageFace{
	{"sans-400", "Blog Sans", 400},
	{"sans-500", "Blog Sans", 500},
	{"serif-400", "Blog Serif", 400},
	{"serif-500", "Blog Serif", 500},
	{"serif-600", "Blog Serif", 600},
}

// firstScreenRunes caps the inlined part on pages without section headings.
const firstScreenRunes = 1200

type fontSubsetter struct {
	faces     []*font.SFNT
	dir, base string // where late files are written, and their URL prefix
	lateFonts map[string]bool
}

func newFontSubsetter(dir, base string) (*fontSubsetter, error) {
	f := &fontSubsetter{dir: dir, base: base, lateFonts: map[string]bool{}}
	for _, face := range pageFaces {
		b, err := os.ReadFile(filepath.Join("fonts", face.file+".woff2"))
		if err != nil {
			return nil, fmt.Errorf("%w (run uv run scripts/prepare-fonts.py)", err)
		}
		if b, err = font.ToSFNT(b); err != nil {
			return nil, fmt.Errorf("fonts/%s.woff2: %w", face.file, err)
		}
		sfnt, err := font.ParseSFNT(b, 0)
		if err != nil {
			return nil, fmt.Errorf("fonts/%s.woff2: %w", face.file, err)
		}
		f.faces = append(f.faces, sfnt)
	}
	return f, nil
}

// subset returns a WOFF2 with the glyphs for chars, or nil when the face has none of them.
func (f *fontSubsetter) subset(face int, chars map[rune]bool) ([]byte, error) {
	runes := make([]rune, 0, len(chars))
	for r := range chars {
		runes = append(runes, r)
	}
	slices.Sort(runes)
	ids := []uint16{0}
	for _, r := range runes {
		if id := f.faces[face].GlyphIndex(r); id != 0 && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	if len(ids) == 1 {
		return nil, nil
	}
	sub, err := f.faces[face].Subset(ids, font.SubsetOptions{Tables: font.KeepMinTables})
	if err != nil {
		return nil, err
	}
	return sub.WriteWOFF2()
}

// css returns the @font-face rules for one rendered page. extra is text the
// page shows only after a script runs (search snippets); its glyphs get a
// "Blog Search" face that browsers fetch only once such text appears.
func (f *fontSubsetter) css(page, extra string) (string, error) {
	first, rest := pageText(page)
	var b strings.Builder
	if extra != "" {
		chars := map[rune]bool{}
		for _, r := range extra {
			if r > ' ' && !first[sans400][r] {
				chars[r] = true
			}
		}
		sub, err := f.subset(sans400, chars)
		if err != nil {
			return "", err
		}
		if sub != nil {
			url, err := f.file("search", sub)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&b, `@font-face{font-family:"Blog Search";font-weight:400;font-display:swap;src:url("%s") format("woff2")}`, url)
		}
	}
	for i, face := range pageFaces {
		for r := range first[i] {
			delete(rest[i], r)
		}
		inline, err := f.subset(i, first[i])
		if err != nil {
			return "", fmt.Errorf("%s: %w", face.file, err)
		}
		if inline != nil {
			// Inline faces are already here: block for the moment they take to decode instead of swapping in.
			fmt.Fprintf(&b, `@font-face{font-family:"%s";font-weight:%d;font-display:block;src:url(data:font/woff2;base64,%s) format("woff2")}`, face.family, face.weight, base64.StdEncoding.EncodeToString(inline))
		}
		late, err := f.subset(i, rest[i])
		if err != nil {
			return "", fmt.Errorf("%s: %w", face.file, err)
		}
		if late != nil {
			url, err := f.file(face.file, late)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&b, `@font-face{font-family:"%s Late";font-weight:%d;font-display:swap;src:url("%s") format("woff2")}`, face.family, face.weight, url)
		}
	}
	return b.String(), nil
}

// file writes a late subset once under its content hash and returns its URL.
func (f *fontSubsetter) file(name string, font []byte) (string, error) {
	sum := sha256.Sum256(font)
	name = fmt.Sprintf("%s-%x.woff2", name, sum[:6])
	if !f.lateFonts[name] {
		if err := os.MkdirAll(f.dir, 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(f.dir, name), font, 0644); err != nil {
			return "", err
		}
		f.lateFonts[name] = true
	}
	return f.base + "/" + name, nil
}

type textElement struct {
	tag   string
	class []string
}

func (e textElement) is(class string) bool { return slices.Contains(e.class, class) }

// faceFor mirrors the font-family and font-weight rules in style.css for the
// innermost element of stack; mono text falls back to the sans faces for CJK.
func faceFor(stack []textElement) int {
	n := len(stack)
	parent := func(i int) textElement {
		if i > 0 {
			return stack[i-1]
		}
		return textElement{}
	}
	within := func(class string) bool {
		return slices.ContainsFunc(stack, func(e textElement) bool { return e.is(class) })
	}
serif:
	for i := n - 1; i >= 0; i-- {
		e := stack[i]
		switch {
		case e.is("key") || e.is("code-path") || e.tag == "span" && parent(i).tag == "a" && within("post-pagination"):
			break serif // mono or sans inside a serif block
		case e.tag == "figcaption" && (parent(i).is("data") || parent(i).is("chart") || parent(i).is("stats")):
			return serif600
		case e.tag == "h1" && within("article-header") || e.tag == "h2" && within("post-summary"):
			return serif500
		case (e.tag == "h2" || e.tag == "h3") && within("prose"):
			return serif600
		case e.tag == "h1" || e.is("intro") || e.is("brand") || e.tag == "a" && parent(i).is("post-pagination"):
			return serif400
		}
	}
	for i := n - 1; i >= 0; i-- {
		e := stack[i]
		switch {
		case e.tag == "strong" && within("prose"),
			e.tag == "th" && within("prose") && !within("data"),
			e.tag == "tr" && e.is("mark") && within("data"),
			e.is("dl"),
			e.tag == "b" && (parent(i).is("stats-group") || within("ticker")),
			e.tag == "dd" && within("kpi") && !e.is("s"):
			return sans500
		}
	}
	return sans400
}

var skippedText = []string{"head", "style", "script", "noscript", "svg", "math", "template"}

// pageText collects the characters of each face, split into the first
// screen and the rest of the page.
func pageText(page string) (first, rest [5]map[rune]bool) {
	for i := range first {
		first[i], rest[i] = map[rune]bool{}, map[rune]bool{}
	}
	var stack []textElement
	onFirst, seen := true, 0
	z := html.NewTokenizer(strings.NewReader(page))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return first, rest
		case html.StartTagToken:
			name, hasAttr := z.TagName()
			e := textElement{tag: string(name)}
			for hasAttr {
				var key, value []byte
				key, value, hasAttr = z.TagAttr()
				if string(key) == "class" {
					e.class = strings.Fields(string(value))
				}
			}
			switch e.tag {
			case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr":
				continue
			}
			if e.tag == "h2" && slices.ContainsFunc(stack, func(p textElement) bool { return p.is("prose") }) {
				onFirst = false
			}
			stack = append(stack, e)
		case html.EndTagToken:
			name, _ := z.TagName()
			for i := len(stack) - 1; i >= 0; i-- {
				if stack[i].tag == string(name) {
					stack = stack[:i]
					break
				}
			}
		case html.TextToken:
			if slices.ContainsFunc(stack, func(e textElement) bool { return slices.Contains(skippedText, e.tag) || e.is("sr-only") }) {
				continue
			}
			text := string(z.Text())
			target := &first
			inTOC := slices.ContainsFunc(stack, func(e textElement) bool { return e.is("toc") || e.is("toc-mobile") })
			label := len(stack) > 0 && (stack[len(stack)-1].tag == "summary" || stack[len(stack)-1].tag == "p")
			if !onFirst || seen > firstScreenRunes || inTOC && !label {
				target = &rest
			}
			face := faceFor(stack)
			for _, r := range text {
				if r > ' ' {
					target[face][r] = true
					if !inTOC {
						seen++
					}
				}
			}
		}
	}
}
