package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

type Site struct{ Title, Author, Description, URL string }
type Heading struct {
	ID, Title string
	Level     int
}
type PostMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Date        string `json:"date"`
	Tag         string `json:"tag,omitempty"`
}
type Post struct {
	PostMetadata
	Slug, Path string
	Content    template.HTML
	Minutes    int
	TOC        []Heading `json:"-"`
}
type Page struct {
	Site                           Site
	Title, Description, Path, Kind string
	Post                           *Post
	Previous, Next                 *Post
	Posts                          []Post
	Content                        template.HTML
}
type Feed struct {
	XMLName xml.Name `xml:"rss"`
	Version string   `xml:"version,attr"`
	Channel Channel  `xml:"channel"`
}
type Channel struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	Items       []Item `xml:"item"`
}
type Item struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	Date        string `xml:"pubDate"`
	GUID        string `xml:"guid"`
}
type Sitemap struct {
	XMLName xml.Name   `xml:"urlset"`
	NS      string     `xml:"xmlns,attr"`
	URLs    []Location `xml:"url"`
}
type Location struct {
	URL string `xml:"loc"`
}

// Code is highlighted at build time with classes styled in style.css; unknown languages stay plain.
var markdown = goldmark.New(goldmark.WithExtensions(extension.GFM, mathExtension{}, dataExtension{}, highlighting.NewHighlighting(highlighting.WithFormatOptions(chromahtml.WithClasses(true)))), goldmark.WithParserOptions(parser.WithAutoHeadingID()))
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "new" {
		if err := newPost(os.Args[2:], os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	serve := flag.String("serve", "", "preview address, e.g. localhost:8080")
	base := flag.String("url", "", "override site URL (use http://localhost:8080 for preview)")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments; use go run . new -h to create an article")
	}
	if err := build(*base); err != nil {
		log.Fatal(err)
	}
	if *serve != "" {
		log.Printf("Preview: http://%s (re-run after editing)", *serve)
		log.Fatal(http.ListenAndServe(*serve, serveSite("public")))
	}
}

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

func renderContent(src []byte, images ...func(*ast.Image) error) (template.HTML, []Heading, error) {
	ctx := parser.NewContext(parser.WithIDs(headingIDs{}))
	doc := markdown.Parser().Parse(text.NewReader(src), parser.WithContext(ctx))
	var toc []Heading
	err := ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if image, ok := n.(*ast.Image); entering && ok && len(images) > 0 {
			if err := images[0](image); err != nil {
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
	html := strings.NewReplacer("<pre>", `<pre tabindex="0">`, `<pre class="chroma">`, `<pre tabindex="0" class="chroma">`).Replace(out.String())
	return template.HTML(html), toc, err
}

func readPost(name string, images ...func(*ast.Image) error) (Post, error) {
	var p Post
	src, err := os.ReadFile(name)
	if err != nil {
		return p, err
	}
	parts := strings.SplitN(strings.ReplaceAll(string(src), "\r\n", "\n"), "\n---\n", 2)
	if len(parts) != 2 {
		return p, fmt.Errorf("%s: expected JSON metadata followed by ---", name)
	}
	if err := json.Unmarshal([]byte(parts[0]), &p); err != nil {
		return p, fmt.Errorf("%s: %w", name, err)
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
	p.Content, p.TOC, err = renderContent([]byte(parts[1]), images...)
	p.Minutes = max(1, (readingUnits(parts[1])+299)/300)
	return p, err
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

func build(base string) error {
	var site Site
	data, err := os.ReadFile("site.json")
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, &site); err != nil {
		return err
	}
	if base != "" {
		site.URL = base
	}
	site.URL = strings.TrimRight(site.URL, "/")
	u, err := url.Parse(site.URL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("site URL must be an absolute HTTP(S) URL without query or fragment")
	}
	prefix := strings.TrimRight(u.Path, "/")
	version, err := assetVersion("static")
	if err != nil {
		return err
	}
	tmpl, err := template.New("page.html").Funcs(template.FuncMap{
		"local": func(p string) string { return prefix + p },
		"asset": func(p string) string { return prefix + "/static/" + version + "/" + p },
	}).ParseGlob("templates/*.html")
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(".", ".build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	images := imagePipeline{stage: stage, base: site.URL}
	names, err := filepath.Glob("content/posts/*.md")
	if err != nil {
		return err
	}
	posts := make([]Post, 0, len(names))
	for _, name := range names {
		p, err := readPost(name, images.hook(name))
		if err != nil {
			return err
		}
		posts = append(posts, p)
	}
	sort.Slice(posts, func(i, j int) bool {
		if posts[i].Date == posts[j].Date {
			return posts[i].Slug < posts[j].Slug
		}
		return posts[i].Date > posts[j].Date
	})
	write := func(name string, body []byte) error {
		target := filepath.Join(stage, name)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		return os.WriteFile(target, body, 0644)
	}
	page := func(name string, p Page) error {
		p.Site = site
		var out bytes.Buffer
		if err := tmpl.Execute(&out, p); err != nil {
			return err
		}
		return write(name, out.Bytes())
	}
	if err = page("index.html", Page{Title: site.Title, Description: site.Description, Path: "/", Kind: "home", Posts: posts}); err != nil {
		return err
	}
	feed := Feed{Version: "2.0", Channel: Channel{Title: site.Title, Link: site.URL + "/", Description: site.Description}}
	sitemap := Sitemap{NS: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: []Location{{site.URL + "/"}, {site.URL + "/about/"}}}
	for i := range posts {
		p := &posts[i]
		var previous, next *Post
		if i+1 < len(posts) {
			previous = &posts[i+1]
		}
		if i > 0 {
			next = &posts[i-1]
		}
		if err = page("posts/"+p.Slug+"/index.html", Page{Title: p.Title + " — " + site.Title, Description: p.Description, Path: p.Path, Kind: "post", Post: p, Previous: previous, Next: next}); err != nil {
			return err
		}
		date, _ := time.Parse(time.DateOnly, p.Date)
		link := site.URL + p.Path
		feed.Channel.Items = append(feed.Channel.Items, Item{Title: p.Title, Link: link, Description: string(p.Content), Date: date.Format(time.RFC1123Z), GUID: link})
		sitemap.URLs = append(sitemap.URLs, Location{link})
	}
	about, err := os.ReadFile("content/about.md")
	if err != nil {
		return err
	}
	body, _, err := renderContent(about, images.hook("content/about.md"))
	if err != nil {
		return err
	}
	if err = page("about/index.html", Page{Title: "关于 — " + site.Title, Description: site.Description, Path: "/about/", Kind: "about", Content: body}); err != nil {
		return err
	}
	if err = page("404.html", Page{Title: "页面未找到 — " + site.Title, Description: "这页笔记还不存在。", Kind: "404"}); err != nil {
		return err
	}
	for name, v := range map[string]any{"feed.xml": feed, "sitemap.xml": sitemap} {
		b, err := xml.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		if err = write(name, append([]byte(xml.Header), b...)); err != nil {
			return err
		}
	}
	if err = write("robots.txt", []byte("User-agent: *\nAllow: /\nSitemap: "+site.URL+"/sitemap.xml\n")); err != nil {
		return err
	}
	if err = copyAssets(stage, version); err != nil {
		return err
	}
	var headers strings.Builder
	for _, route := range []string{"/", "/index.html", "/posts/*", "/about/*", "/feed.xml", "/sitemap.xml", "/robots.txt"} {
		fmt.Fprintf(&headers, "%s%s\n  Cache-Control: no-cache\n", prefix, route)
	}
	fmt.Fprintf(&headers, "%s/404.html\n  Cache-Control: no-store\n%s/static/%s/*\n  Cache-Control: public, max-age=31536000, immutable\n%s/images/*\n  Cache-Control: public, max-age=31536000, immutable\n", prefix, prefix, version, prefix)
	if err = write("_headers", []byte(headers.String())); err != nil {
		return err
	}
	// Do not touch the last successful output until every page has rendered.
	if err = os.RemoveAll("public"); err != nil {
		return err
	}
	if err = os.Rename(stage, "public"); err != nil {
		return err
	}
	fmt.Printf("Built %d posts → public/\n", len(posts))
	return nil
}
