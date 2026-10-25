package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"

	cjkfriendly "github.com/tats-u/goldmark-cjk-friendly/v2"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

type Heading struct {
	ID, Title string
	Level     int
}

type PostMetadata struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Date        string   `json:"date"`
	Tag         string   `json:"tag,omitempty"` // the category
	Tags        []string `json:"tags,omitempty"`
	Updated     string   `json:"updated,omitempty"`
	Draft       bool     `json:"draft,omitempty"`
	Aliases     []string `json:"aliases,omitempty"`
}

type Post struct {
	PostMetadata
	Slug, Path, File string
	Lang             *Lang
	Content          template.HTML
	Minutes, Units   int
	TOC              []Heading
	Category         *Term
	Terms            []*Term
	History          []Commit
	Source           string
	Translation      *Post
	body             []byte // Markdown after the metadata
}

// Modified is the last substantive edit, for dateModified and sitemap lastmod.
func (p Post) Modified() string {
	if p.Updated != "" {
		return p.Updated
	}
	return p.Date
}

func init() {
	// Goldmark drops image attributes it does not know; images.go sets this one.
	gmhtml.ImageAttributeFilter = gmhtml.ImageAttributeFilter.Extend([]byte("fetchpriority"))
}

// newMarkdown is the renderer of one edition; only the ticker button text differs.
// CommonMark won't open or close ** between CJK punctuation and a letter, as in
// 用**“引语”**完成; the CJK-friendly parsers allow it.
func newMarkdown(ui UI) goldmark.Markdown {
	return goldmark.New(goldmark.WithExtensions(extension.GFM, cjkfriendly.CJKFriendlyEmphasisAndStrikethrough, mathExtension{}, dataExtension{}, tickerExtension{button: ui.LiveChart}, codeExtension{}), goldmark.WithParserOptions(parser.WithAutoHeadingID()))
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// headingIDs keeps CJK and other letters so anchors stay readable, e.g. #问题一屏幕花屏.
type headingIDs map[string]bool

func (ids headingIDs) Generate(value []byte, _ ast.NodeKind) []byte {
	var b strings.Builder
	for _, r := range strings.ToLower(string(value)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) || r == '_':
			b.WriteRune(r)
		case unicode.IsSpace(r) || r == '-':
			b.WriteByte('-')
		}
	}
	id := strings.Trim(b.String(), "-")
	if id == "" {
		id = "section"
	}
	for i, base := 1, id; ids[id]; i++ {
		id = fmt.Sprintf("%s-%d", base, i)
	}
	ids[id] = true
	return []byte(id)
}

func (ids headingIDs) Put(value []byte) { ids[string(value)] = true }

func plainText(n ast.Node, src []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		switch t := c.(type) {
		case *ast.Text:
			if entering {
				b.Write(t.Segment.Value(src))
			}
		case *ast.String:
			if entering {
				b.Write(t.Value)
			}
		}
		return ast.WalkContinue, nil
	})
	return b.String()
}

// renderContent renders a post body with an edition's renderer; image, when not nil, rewrites each image node.
func renderContent(markdown goldmark.Markdown, src []byte, image func(*ast.Image) error) (template.HTML, []Heading, error) {
	ctx := parser.NewContext(parser.WithIDs(headingIDs{}))
	doc := markdown.Parser().Parse(text.NewReader(src), parser.WithContext(ctx))
	var toc []Heading
	err := ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if node, ok := n.(*ast.Image); entering && ok && image != nil {
			if err := image(node); err != nil {
				return ast.WalkStop, err
			}
		}
		if h, ok := n.(*ast.Heading); entering && ok && h.Level >= 2 && h.Level <= 3 {
			id, _ := h.AttributeString("id")
			toc = append(toc, Heading{ID: string(id.([]byte)), Title: plainText(h, src), Level: h.Level})
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return "", nil, err
	}
	var out bytes.Buffer
	err = markdown.Renderer().Render(&out, src, doc)
	// Only Goldmark output crosses the template trust boundary. Raw HTML stays disabled.
	html := strings.ReplaceAll(out.String(), "<pre>", `<pre tabindex="0">`)
	return template.HTML(html), toc, err
}

var sectionHeading = regexp.MustCompile(`<h([23]) id="([^"]+)">`)

// withAnchors adds a hover link to each section heading; feeds keep the plain HTML.
func withAnchors(content template.HTML) template.HTML {
	return template.HTML(sectionHeading.ReplaceAllString(string(content), `<h$1 id="$2"><a class="anchor" href="#$2" aria-hidden="true" tabindex="-1">#</a>`))
}

// readPost parses and validates a post; render turns its body into HTML.
func readPost(name string) (Post, error) {
	var p Post
	src, err := os.ReadFile(name)
	if err != nil {
		return p, err
	}
	parts := strings.SplitN(strings.ReplaceAll(string(src), "\r\n", "\n"), "\n---\n", 2)
	if len(parts) != 2 {
		return p, fmt.Errorf("%s: expected JSON metadata followed by ---", name)
	}
	// Unknown keys fail the build, so a typo such as "udpated" is never silently dropped.
	decoder := json.NewDecoder(strings.NewReader(parts[0]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p.PostMetadata); err != nil {
		return p, fmt.Errorf("%s: metadata: %w", name, err)
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return p, fmt.Errorf("%s: metadata: unexpected data after the JSON object", name)
	}
	p.Slug = strings.TrimSuffix(filepath.Base(name), ".md")
	if !slugPattern.MatchString(p.Slug) {
		return p, fmt.Errorf("invalid slug: %s", p.Slug)
	}
	if strings.TrimSpace(p.Title) == "" || strings.TrimSpace(p.Description) == "" {
		return p, fmt.Errorf("%s: title and description are required", name)
	}
	if _, err := time.Parse(time.DateOnly, p.Date); err != nil {
		return p, fmt.Errorf("%s: invalid date: %w", name, err)
	}
	p.Path = "/posts/" + p.Slug + "/"
	if p.Updated != "" {
		if _, err := time.Parse(time.DateOnly, p.Updated); err != nil || p.Updated < p.Date {
			return p, fmt.Errorf("%s: updated must be a YYYY-MM-DD date on or after date", name)
		}
	}
	p.body = []byte(parts[1])
	p.Units = readingUnits(parts[1])
	p.Minutes = max(1, (p.Units+299)/300)
	return p, nil
}

// render fills Content and TOC in the post's edition; image, when not nil, rewrites each image.
func (p *Post) render(image func(*ast.Image) error) (err error) {
	p.Content, p.TOC, err = renderContent(p.Lang.markdown(), p.body, image)
	return err
}

// readingUnits counts each Han character and each other word once, skipping
// fenced code and data blocks, which readers scan rather than read.
func readingUnits(src string) int {
	units, fence, inWord := 0, "", false
	for _, line := range strings.Split(src, "\n") {
		if trimmed := strings.TrimSpace(line); strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
			if fence == "" {
				fence = trimmed[:3]
			} else if strings.HasPrefix(trimmed, fence) {
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		for _, r := range line + " " {
			switch {
			case unicode.Is(unicode.Han, r):
				units++
				inWord = false
			case unicode.IsLetter(r) || unicode.IsDigit(r):
				if !inWord {
					units++
				}
				inWord = true
			default:
				inWord = false
			}
		}
	}
	return units
}
