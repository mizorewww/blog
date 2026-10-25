package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"html/template"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	gmhtml "github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
)

type Site struct {
	Title, Author, Description, URL, About, Repo, Email string
	SameAs                                              []string
	Redirects                                           []Redirect
	Commit                                              string `json:"-"`
}
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
}

// Modified is the last substantive edit, for dateModified and sitemap lastmod.
func (p Post) Modified() string {
	if p.Updated != "" {
		return p.Updated
	}
	return p.Date
}

// Link points at the same page in another edition.
type Link struct{ Lang, Path, Label string }

type Page struct {
	Site                           Site
	Lang                           *Lang
	UI                             UI
	Title, Description, Path, Kind string
	Post                           *Post
	Previous, Next                 *Post
	Posts                          []*Post
	Term                           *Term
	TermKind, Stats                string
	Categories, Tags               []*Term
	Switch                         *Link
	Alternates                     []Link
}
type Feed struct {
	XMLName xml.Name `xml:"rss"`
	Version string   `xml:"version,attr"`
	Channel Channel  `xml:"channel"`
}
type Channel struct {
	Title       string   `xml:"title"`
	Link        string   `xml:"link"`
	Self        AtomLink `xml:"http://www.w3.org/2005/Atom link"`
	Description string   `xml:"description"`
	Language    string   `xml:"language"`
	BuildDate   string   `xml:"lastBuildDate,omitempty"`
	Items       []Item   `xml:"item"`
}
type AtomLink struct {
	Href string `xml:"href,attr"`
	Rel  string `xml:"rel,attr"`
	Type string `xml:"type,attr"`
}
type Item struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	Description string `xml:"description"`
	Category    string `xml:"category,omitempty"`
	Date        string `xml:"pubDate"`
	GUID        string `xml:"guid"`
}
type Sitemap struct {
	XMLName xml.Name   `xml:"urlset"`
	NS      string     `xml:"xmlns,attr"`
	URLs    []Location `xml:"url"`
}
type Location struct {
	URL     string `xml:"loc"`
	LastMod string `xml:"lastmod,omitempty"`
}

func init() {
	// Goldmark drops image attributes it does not know; images.go sets this one.
	gmhtml.ImageAttributeFilter = gmhtml.ImageAttributeFilter.Extend([]byte("fetchpriority"))
}

var markdown = goldmark.New(goldmark.WithExtensions(extension.GFM, mathExtension{}, dataExtension{}, tickerExtension{}, codeExtension{}), goldmark.WithParserOptions(parser.WithAutoHeadingID()))
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// includeDrafts builds posts marked "draft": true, for previews only.
var includeDrafts bool

func main() {
	if len(os.Args) > 1 && os.Args[1] == "new" {
		if err := newPost(os.Args[2:], os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	serve := flag.String("serve", "", "preview address, e.g. localhost:8080")
	base := flag.String("url", "", "override site URL (use http://localhost:8080 for preview)")
	flag.BoolVar(&includeDrafts, "drafts", false, "also build draft posts")
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

// renderContent renders a post body; image, when not nil, rewrites each image node.
func renderContent(src []byte, image func(*ast.Image) error) (template.HTML, []Heading, error) {
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

func readPost(name string, image func(*ast.Image) error) (Post, error) {
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
	p.Content, p.TOC, err = renderContent([]byte(parts[1]), image)
	p.Units = readingUnits(parts[1])
	p.Minutes = max(1, (p.Units+299)/300)
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
	site.Commit = gitHead()
	u, err := url.Parse(site.URL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("site URL must be an absolute HTTP(S) URL without query or fragment")
	}
	prefix := strings.TrimRight(u.Path, "/")
	version, err := assetVersion("static")
	if err != nil {
		return err
	}
	css, err := pageCSS(prefix + "/static/" + version)
	if err != nil {
		return err
	}
	// The footer year is the newest post's, so a rebuild in January changes nothing.
	year := ""
	tmpl, err := template.New("page.html").Funcs(template.FuncMap{
		"css":     func() template.CSS { return css },
		"local":   func(p string) string { return prefix + p },
		"jsonld":  structuredData,
		"asset":   func(p string) string { return prefix + "/static/" + version + "/" + p },
		"year":    func() string { return year },
		"anchors": withAnchors,
		"profile": func(link string) string {
			u, err := url.Parse(link)
			if err != nil {
				return link
			}
			switch strings.TrimPrefix(u.Hostname(), "www.") {
			case "github.com":
				return "GitHub"
			case "x.com", "twitter.com":
				return "X"
			case "t.me":
				return "Telegram"
			}
			return u.Hostname()
		},
	}).ParseGlob("templates/*.html")
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(".", ".build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	fonts, err := newFontSubsetter(filepath.Join(stage, "static", version, "fonts"), prefix+"/static/"+version+"/fonts")
	if err != nil {
		return err
	}
	images := imagePipeline{stage: stage, base: site.URL}

	// Read every edition first, so translations can link to each other.
	editions := make([][]*Post, len(languages))
	for li := range languages {
		lang := &languages[li]
		if lang.Base == "" {
			lang.UI.Description = site.Description
		}
		dir := filepath.Join("content", "posts", lang.Code)
		if lang.Base == "" {
			dir = filepath.Join("content", "posts")
		}
		names, err := filepath.Glob(filepath.Join(dir, "*.md"))
		if err != nil {
			return err
		}
		for _, name := range names {
			p, err := readPost(name, images.hook(name))
			if err != nil {
				return err
			}
			if p.Draft && !includeDrafts {
				continue
			}
			p.File, p.Lang, p.Path = name, lang, lang.Base+p.Path
			if p.History = gitHistory(name); len(p.History) > 0 && site.Repo != "" {
				p.Source = site.Repo + "/blob/main/" + filepath.ToSlash(name)
			}
			editions[li] = append(editions[li], &p)
		}
		posts := editions[li]
		sort.Slice(posts, func(i, j int) bool {
			if posts[i].Date == posts[j].Date {
				return posts[i].Slug < posts[j].Slug
			}
			return posts[i].Date > posts[j].Date
		})
	}
	for li := range editions {
		for _, p := range editions[li] {
			year = max(year, p.Date[:4])
			for lj := range editions {
				for _, q := range editions[lj] {
					if lj != li && q.Slug == p.Slug {
						p.Translation = q
					}
				}
			}
		}
	}

	write := func(name string, body []byte) error {
		target := filepath.Join(stage, name)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		return os.WriteFile(target, body, 0644)
	}
	page := func(name string, p Page, extra string) error {
		p.Site, p.UI = site, p.Lang.UI
		if p.Switch != nil {
			p.Alternates = []Link{{p.Lang.HTML, p.Path, ""}, {p.Lang.UI.SwitchLang, p.Switch.Path, ""}}
		}
		var out bytes.Buffer
		if err := tmpl.Execute(&out, p); err != nil {
			return err
		}
		faces, err := fonts.css(out.String(), extra)
		if err != nil {
			return fmt.Errorf("%s: fonts: %w", name, err)
		}
		return write(name, []byte(strings.Replace(out.String(), pageFontsMarker, faces, 1)))
	}
	file := func(path string) string { return strings.TrimPrefix(path, "/") + "index.html" }
	// Dates come from content, not the clock, so unchanged content builds identical files.
	newestOf := func(posts []*Post) string {
		newest := ""
		for _, p := range posts {
			newest = max(newest, p.Modified())
		}
		return newest
	}
	sitemap := Sitemap{NS: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	feeds := map[string]Feed{}
	var all []*Post

	for li := range languages {
		lang, posts := &languages[li], editions[li]
		if lang.Base != "" && len(posts) == 0 {
			continue
		}
		all = append(all, posts...)
		other := func(path string) *Link {
			for lj := range languages {
				if lj != li && (languages[lj].Base == "" || len(editions[lj]) > 0) {
					return &Link{languages[lj].HTML, languages[lj].Base + path, lang.UI.Switch}
				}
			}
			return nil
		}
		categories := collectTerms(posts, lang.Base, "categories", func(p *Post) []string { return []string{p.Tag} })
		tags := collectTerms(posts, lang.Base, "tags", func(p *Post) []string { return p.Tags })
		units := 0
		for _, p := range posts {
			units += p.Units
			for _, c := range categories {
				if c.Slug == termSlug(p.Tag) {
					p.Category = c
				}
			}
			for _, name := range p.Tags {
				for _, t := range tags {
					if t.Slug == termSlug(name) && !slices.Contains(p.Terms, t) {
						p.Terms = append(p.Terms, t)
					}
				}
			}
		}
		words := strconv.Itoa(units)
		switch {
		case lang.Code == "zh" && units >= 10000:
			words = strconv.FormatFloat(float64(units)/10000, 'f', 1, 64) + " 万"
		case lang.Code != "zh" && units >= 1000:
			words = strconv.FormatFloat(float64(units)/1000, 'f', 1, 64) + "k"
		}
		stats := fmt.Sprintf(lang.UI.Stats, len(posts), len(categories), len(tags), words)
		home := lang.Base + "/"
		if err = page(file(home), Page{Lang: lang, Title: site.Title, Description: lang.UI.Description, Path: home, Kind: "home", Posts: posts, Categories: categories, Tags: tags, Stats: stats, Switch: other("/")}, ""); err != nil {
			return err
		}
		sitemap.URLs = append(sitemap.URLs, Location{site.URL + home, newestOf(posts)})

		feed := func(path, title, description string, posts []*Post) {
			f := Feed{Version: "2.0", Channel: Channel{Title: title, Link: site.URL + strings.TrimSuffix(path, "feed.xml"), Description: description, Language: lang.HTML,
				Self: AtomLink{Href: site.URL + path, Rel: "self", Type: "application/rss+xml"}}}
			if newest := newestOf(posts); newest != "" {
				updated, _ := time.Parse(time.DateOnly, newest)
				f.Channel.BuildDate = updated.Format(time.RFC1123Z)
			}
			for _, p := range posts {
				date, _ := time.Parse(time.DateOnly, p.Date)
				link := site.URL + p.Path
				guid := link
				if len(p.Aliases) > 0 {
					guid = site.URL + escapePath(p.Aliases[0]) // keeps feed readers from re-announcing moved posts
				}
				f.Channel.Items = append(f.Channel.Items, Item{Title: p.Title, Link: link, Description: string(p.Content), Category: p.Tag, Date: date.Format(time.RFC1123Z), GUID: guid})
			}
			feeds[strings.TrimPrefix(path, "/")] = f
		}
		feed(lang.Base+"/feed.xml", site.Title, lang.UI.Description, posts)

		for i, p := range posts {
			var previous, next *Post
			if i+1 < len(posts) {
				previous = posts[i+1]
			}
			if i > 0 {
				next = posts[i-1]
			}
			var sw *Link
			if p.Translation != nil {
				sw = &Link{p.Translation.Lang.HTML, p.Translation.Path, lang.UI.Switch}
			}
			if err = page(file(p.Path), Page{Lang: lang, Title: p.Title + " — " + site.Title, Description: p.Description, Path: p.Path, Kind: "post", Post: p, Previous: previous, Next: next, Switch: sw}, ""); err != nil {
				return err
			}
			sitemap.URLs = append(sitemap.URLs, Location{site.URL + p.Path, p.Modified()})
		}

		if len(posts) > 0 {
			path := lang.Base + "/tags/"
			if err = page(file(path), Page{Lang: lang, Title: lang.UI.TagsTitle + " — " + site.Title, Description: stats, Path: path, Kind: "tags", Categories: categories, Tags: tags, Switch: other("/tags/")}, ""); err != nil {
				return err
			}
			for kind, terms := range map[string][]*Term{lang.UI.Category: categories, lang.UI.Tag: tags} {
				for _, t := range terms {
					description := fmt.Sprintf(lang.UI.Count, len(t.Posts))
					if err = page(file(t.Path), Page{Lang: lang, Title: t.Name + " — " + site.Title, Description: kind + " · " + t.Name + " · " + description, Path: t.Path, Kind: "term", TermKind: kind, Term: t, Posts: t.Posts, Switch: other("/tags/")}, ""); err != nil {
						return err
					}
					feed(t.Path+"feed.xml", t.Name+" — "+site.Title, description, t.Posts)
					sitemap.URLs = append(sitemap.URLs, Location{site.URL + t.Path, newestOf(t.Posts)})
				}
			}

			// Search filters the listed posts with an index of their text, fetched on first use.
			type entry struct {
				Title string `json:"t"`
				Text  string `json:"x"`
			}
			index := map[string]entry{}
			var corpus strings.Builder
			for _, p := range posts {
				words := []string{p.Title, p.Description, p.Tag}
				words = append(words, p.Tags...)
				text := contentText(string(p.Content))
				index[p.Path] = entry{strings.Join(words, " "), text}
				corpus.WriteString(text)
			}
			corpus.WriteString(lang.UI.SearchFound + lang.UI.SearchNone)
			b, err := json.Marshal(index)
			if err != nil {
				return err
			}
			if err = write(strings.TrimPrefix(lang.Base+"/search.json", "/"), b); err != nil {
				return err
			}
			path = lang.Base + "/search/"
			if err = page(file(path), Page{Lang: lang, Title: lang.UI.Search + " — " + site.Title, Description: lang.UI.SearchLabel, Path: path, Kind: "search", Posts: posts, Switch: other("/search/")}, corpus.String()); err != nil {
				return err
			}
		}
	}

	if err = page("404.html", Page{Lang: &languages[0], Title: "页面未找到 — " + site.Title, Description: "这页笔记还不存在。", Kind: "404"}, ""); err != nil {
		return err
	}
	for name, f := range feeds {
		b, err := xml.MarshalIndent(f, "", "  ")
		if err != nil {
			return err
		}
		if err = write(name, append([]byte(xml.Header), b...)); err != nil {
			return err
		}
	}
	b, err := xml.MarshalIndent(sitemap, "", "  ")
	if err != nil {
		return err
	}
	if err = write("sitemap.xml", append([]byte(xml.Header), b...)); err != nil {
		return err
	}
	if err = write("robots.txt", []byte("User-agent: *\nAllow: /\nSitemap: "+site.URL+"/sitemap.xml\n")); err != nil {
		return err
	}
	if err = writeRedirects(site, prefix, all, write); err != nil {
		return err
	}
	if err = copyAssets(stage, version); err != nil {
		return err
	}
	var headers strings.Builder
	for _, route := range []string{"/", "/index.html", "/posts/*", "/tags/*", "/categories/*", "/search/*", "/search.json", "/en/*", "/feed.xml", "/sitemap.xml", "/robots.txt"} {
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
	fmt.Printf("Built %d posts → public/\n", len(all))
	return nil
}
