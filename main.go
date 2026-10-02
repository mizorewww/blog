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

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
)

type Site struct{ Title, Author, Description, URL, GitHub string }
type Post struct {
	Title, Description, Date, Tag string
	Slug, Path                    string
	Content                       template.HTML
	Minutes                       int
}
type Page struct {
	Site                           Site
	Title, Description, Path, Kind string
	Post                           *Post
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

var markdown = goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithParserOptions(parser.WithAutoHeadingID()))
var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func main() {
	serve := flag.String("serve", "", "preview address, e.g. localhost:8080")
	base := flag.String("url", "", "override site URL (use http://localhost:8080 for preview)")
	flag.Parse()
	if err := build(*base); err != nil {
		log.Fatal(err)
	}
	if *serve != "" {
		log.Printf("Preview: http://%s (re-run after editing)", *serve)
		fs := http.FileServer(http.Dir("public"))
		log.Fatal(http.ListenAndServe(*serve, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := filepath.Join("public", filepath.Clean("/"+r.URL.Path))
			info, err := os.Stat(p)
			if err == nil && info.IsDir() {
				_, err = os.Stat(filepath.Join(p, "index.html"))
			}
			if err != nil {
				body, _ := os.ReadFile("public/404.html")
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write(body)
				return
			}
			fs.ServeHTTP(w, r)
		})))
	}
}

func renderMarkdown(src []byte) (template.HTML, error) {
	var out bytes.Buffer
	err := markdown.Convert(src, &out)
	// Only Goldmark output crosses the template trust boundary. Raw HTML stays disabled.
	return template.HTML(strings.ReplaceAll(out.String(), "<pre>", `<pre tabindex="0">`)), err
}

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
	p.Content, err = renderMarkdown([]byte(parts[1]))
	units := len(strings.Fields(parts[1]))
	for _, r := range parts[1] {
		if unicode.Is(unicode.Han, r) {
			units++
		}
	}
	p.Minutes = max(1, (units+299)/300)
	return p, err
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
	tmpl, err := template.New("page.html").Funcs(template.FuncMap{
		"local": func(p string) string { return prefix + p },
	}).ParseGlob("templates/*.html")
	if err != nil {
		return err
	}
	names, err := filepath.Glob("content/posts/*.md")
	if err != nil {
		return err
	}
	posts := make([]Post, 0, len(names))
	for _, name := range names {
		p, err := readPost(name)
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
	stage, err := os.MkdirTemp(".", ".build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
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
		if err = page("posts/"+p.Slug+"/index.html", Page{Title: p.Title + " — " + site.Title, Description: p.Description, Path: p.Path, Kind: "post", Post: p}); err != nil {
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
	body, err := renderMarkdown(about)
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
	if err = os.CopyFS(filepath.Join(stage, "static"), os.DirFS("static")); err != nil {
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
