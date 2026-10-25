package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"html/template"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

// Options are the choices of one build.
type Options struct {
	URL    string // overrides the site.json URL, e.g. for a local preview
	Drafts bool   // also builds posts marked "draft": true
}

// edition is one language's posts and the indexes built from them.
type edition struct {
	lang             *Lang
	posts            []*Post
	categories, tags []*Term
	stats            string
}

// published reports whether the edition gets pages: the root one always does,
// the others once they have a post.
func (e *edition) published() bool { return e.lang.Base == "" || len(e.posts) > 0 }

// builder renders the site into a staging directory, which replaces public/
// only after every file has been written.
type builder struct {
	Options
	site     Site
	prefix   string // URL path of the site root; "" at a domain root
	version  string // content hash of static/, the versioned asset directory
	stage    string
	tmpl     *template.Template
	fonts    *fontSubsetter
	images   imagePipeline
	editions []*edition
	feeds    map[string]Feed
	sitemap  Sitemap
	year     string // the newest post's year, for the footer
}

func build(opts Options) error {
	b := &builder{Options: opts, feeds: map[string]Feed{}, sitemap: Sitemap{NS: "http://www.sitemaps.org/schemas/sitemap/0.9"}}
	if err := b.loadSite(); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(".", ".build-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	b.stage = stage
	if err = b.prepare(); err != nil {
		return err
	}
	if err = b.readEditions(); err != nil {
		return err
	}
	b.linkTranslations()
	for _, e := range b.editions {
		if !e.published() {
			continue
		}
		if err = b.writeEdition(e); err != nil {
			return err
		}
	}
	steps := []func() error{
		b.writeFeeds,
		b.writeSitemap,
		func() error {
			return b.write("robots.txt", []byte("User-agent: *\nAllow: /\nSitemap: "+b.site.URL+"/sitemap.xml\n"))
		},
		func() error { return writeRedirects(b.site, b.prefix, b.allPosts(), b.write) },
		func() error { return copyAssets(b.stage, b.version) },
		b.writeHeaders,
		func() error { return checkLinks(b.stage, b.site.URL, b.prefix) },
		b.publish,
	}
	for _, step := range steps {
		if err = step(); err != nil {
			return err
		}
	}
	fmt.Printf("Built %d posts → public/\n", len(b.allPosts()))
	return nil
}

// loadSite reads site.json and checks the URL the pages will link to.
func (b *builder) loadSite() error {
	data, err := os.ReadFile("site.json")
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, &b.site); err != nil {
		return fmt.Errorf("site.json: %w", err)
	}
	if b.URL != "" {
		b.site.URL = b.URL
	}
	b.site.URL = strings.TrimRight(b.site.URL, "/")
	b.site.Commit = gitHead()
	u, err := url.Parse(b.site.URL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("site URL must be an absolute HTTP(S) URL without query or fragment")
	}
	b.prefix = strings.TrimRight(u.Path, "/")
	// Each build gets its own copy of the editions, so nothing global changes.
	for _, lang := range languages {
		if lang.Base == "" {
			lang.UI.Description = b.site.Description
		}
		b.editions = append(b.editions, &edition{lang: &lang})
	}
	return nil
}

// prepare parses the template and sets up the font and image pipelines.
func (b *builder) prepare() error {
	var err error
	if b.version, err = assetVersion("static"); err != nil {
		return err
	}
	css, err := pageCSS(b.prefix + "/static/" + b.version)
	if err != nil {
		return err
	}
	b.tmpl, err = template.New("page.html").Funcs(template.FuncMap{
		"css":     func() template.CSS { return css },
		"local":   func(p string) string { return b.prefix + p },
		"jsonld":  structuredData,
		"asset":   func(p string) string { return b.prefix + "/static/" + b.version + "/" + p },
		"year":    func() string { return b.year },
		"anchors": withAnchors,
		"profile": profileName,
	}).ParseGlob("templates/*.html")
	if err != nil {
		return err
	}
	b.fonts, err = newFontSubsetter(filepath.Join(b.stage, "static", b.version, "fonts"), b.prefix+"/static/"+b.version+"/fonts")
	b.images = imagePipeline{stage: b.stage, base: b.site.URL}
	return err
}

// readEditions reads and renders every post, newest first in each edition.
func (b *builder) readEditions() error {
	for _, e := range b.editions {
		dir := filepath.Join("content", "posts")
		if e.lang.Base != "" {
			dir = filepath.Join(dir, e.lang.Code)
		}
		names, err := filepath.Glob(filepath.Join(dir, "*.md"))
		if err != nil {
			return err
		}
		for _, name := range names {
			p, err := readPost(name)
			if err != nil {
				return err
			}
			// Skip drafts before rendering, so their images are never published.
			if p.Draft && !b.Drafts {
				continue
			}
			p.File, p.Lang, p.Path = name, e.lang, e.lang.Base+p.Path
			if err = p.render(b.images.hook(name)); err != nil {
				return err
			}
			if p.History = gitHistory(name); len(p.History) > 0 && b.site.Repo != "" {
				p.Source = b.site.Repo + "/blob/main/" + filepath.ToSlash(name)
			}
			b.year = max(b.year, p.Date[:4])
			e.posts = append(e.posts, &p)
		}
		sort.Slice(e.posts, func(i, j int) bool {
			if e.posts[i].Date == e.posts[j].Date {
				return e.posts[i].Slug < e.posts[j].Slug
			}
			return e.posts[i].Date > e.posts[j].Date
		})
	}
	return nil
}

// linkTranslations pairs posts with the same slug in different editions.
func (b *builder) linkTranslations() {
	bySlug := map[string][]*Post{}
	for _, e := range b.editions {
		for _, p := range e.posts {
			bySlug[p.Slug] = append(bySlug[p.Slug], p)
		}
	}
	for _, versions := range bySlug {
		for _, p := range versions {
			for _, q := range versions {
				if q.Lang != p.Lang {
					p.Translation = q
				}
			}
		}
	}
}

func (b *builder) allPosts() []*Post {
	var all []*Post
	for _, e := range b.editions {
		all = append(all, e.posts...)
	}
	return all
}

// switchTo links the same page in the first other published edition.
func (b *builder) switchTo(from *edition, path string) *Link {
	for _, e := range b.editions {
		if e != from && e.published() {
			return &Link{e.lang.HTML, e.lang.Base + path, from.lang.UI.Switch}
		}
	}
	return nil
}

// writeEdition writes every page and feed of one language.
func (b *builder) writeEdition(e *edition) error {
	if err := b.indexTerms(e); err != nil {
		return err
	}
	steps := []func(*edition) error{b.writeHome, b.writePosts, b.writeNotFound}
	if len(e.posts) > 0 {
		steps = append(steps, b.writeTerms, b.writeSearch)
	}
	for _, step := range steps {
		if err := step(e); err != nil {
			return err
		}
	}
	return nil
}

func (b *builder) writeHome(e *edition) error {
	home := e.lang.Base + "/"
	if err := b.page(home, Page{Lang: e.lang, Title: b.site.Title, Description: e.lang.UI.Description, Kind: "home", Posts: e.posts, Categories: e.categories, Tags: e.tags, Stats: e.stats, Switch: b.switchTo(e, "/")}, ""); err != nil {
		return err
	}
	b.sitemap.URLs = append(b.sitemap.URLs, Location{b.site.URL + home, newestOf(e.posts)})
	b.feed(e.lang, e.lang.Base+"/feed.xml", b.site.Title, e.lang.UI.Description, e.posts)
	return nil
}

func (b *builder) writePosts(e *edition) error {
	for i, p := range e.posts {
		var previous, next *Post
		if i+1 < len(e.posts) {
			previous = e.posts[i+1]
		}
		if i > 0 {
			next = e.posts[i-1]
		}
		var sw *Link
		if p.Translation != nil {
			sw = &Link{p.Translation.Lang.HTML, p.Translation.Path, e.lang.UI.Switch}
		}
		if err := b.page(p.Path, Page{Lang: e.lang, Title: p.Title + " — " + b.site.Title, Description: p.Description, Kind: "post", Post: p, Previous: previous, Next: next, Switch: sw}, ""); err != nil {
			return err
		}
		b.sitemap.URLs = append(b.sitemap.URLs, Location{b.site.URL + p.Path, p.Modified()})
	}
	return nil
}

// writeTerms writes the tag overview and a page and feed per category and tag.
func (b *builder) writeTerms(e *edition) error {
	ui := e.lang.UI
	if err := b.page(e.lang.Base+"/tags/", Page{Lang: e.lang, Title: ui.TagsTitle + " — " + b.site.Title, Description: e.stats, Kind: "tags", Categories: e.categories, Tags: e.tags, Switch: b.switchTo(e, "/tags/")}, ""); err != nil {
		return err
	}
	for _, group := range []struct {
		kind  string
		terms []*Term
	}{{ui.Category, e.categories}, {ui.Tag, e.tags}} {
		for _, t := range group.terms {
			count := fmt.Sprintf(ui.Count, len(t.Posts))
			if err := b.page(t.Path, Page{Lang: e.lang, Title: t.Name + " — " + b.site.Title, Description: group.kind + " · " + t.Name + " · " + count, Kind: "term", TermKind: group.kind, Term: t, Posts: t.Posts, Switch: b.switchTo(e, "/tags/")}, ""); err != nil {
				return err
			}
			b.feed(e.lang, t.Path+"feed.xml", t.Name+" — "+b.site.Title, count, t.Posts)
			b.sitemap.URLs = append(b.sitemap.URLs, Location{b.site.URL + t.Path, newestOf(t.Posts)})
		}
	}
	return nil
}

// writeNotFound writes the edition's 404.html; Cloudflare Pages serves the nearest one.
func (b *builder) writeNotFound(e *edition) error {
	return b.page(e.lang.Base+"/404.html", Page{Lang: e.lang, Title: e.lang.UI.NotFoundTitle + " — " + b.site.Title, Description: e.lang.UI.NotFoundDek, Kind: "404"}, "")
}

func (b *builder) write(name string, body []byte) error {
	target := filepath.Join(b.stage, name)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	return os.WriteFile(target, body, 0644)
}

// page renders one HTML page at path, a directory URL like /posts/x/ or a file
// like /404.html, with the fonts its text needs. extra is text the page shows
// only after a script runs.
func (b *builder) page(path string, p Page, extra string) error {
	p.Site, p.UI = b.site, p.Lang.UI
	name := strings.TrimPrefix(path, "/")
	if strings.HasSuffix(path, "/") {
		p.Path = path
		name += "index.html"
	}
	if p.Switch != nil {
		p.Alternates = []Link{{p.Lang.HTML, p.Path, ""}, {p.Lang.UI.SwitchLang, p.Switch.Path, ""}}
	}
	var out bytes.Buffer
	if err := b.tmpl.Execute(&out, p); err != nil {
		return err
	}
	faces, err := b.fonts.css(out.String(), extra)
	if err != nil {
		return fmt.Errorf("%s: fonts: %w", name, err)
	}
	return b.write(name, []byte(strings.Replace(out.String(), pageFontsMarker, faces, 1)))
}

// writeHeaders writes Cloudflare Pages cache rules: documents revalidate,
// content-hashed assets are immutable. Routes come from what the build wrote,
// so a new top-level section is never left to the host's default caching.
func (b *builder) writeHeaders() error {
	entries, err := os.ReadDir(b.stage)
	if err != nil {
		return err
	}
	routes := []string{"/"}
	for _, entry := range entries {
		name := entry.Name()
		switch {
		case name == "static" || name == "images" || name == "404.html" || strings.HasPrefix(name, "_"):
		case entry.IsDir():
			routes = append(routes, "/"+name+"/*")
		case slices.Contains([]string{".html", ".xml", ".json", ".txt"}, filepath.Ext(name)):
			routes = append(routes, "/"+name)
		}
	}
	var headers strings.Builder
	for _, route := range routes {
		fmt.Fprintf(&headers, "%s%s\n  Cache-Control: no-cache\n", b.prefix, route)
	}
	fmt.Fprintf(&headers, "%s/404.html\n  Cache-Control: no-store\n%s/static/%s/*\n  Cache-Control: public, max-age=31536000, immutable\n%s/images/*\n  Cache-Control: public, max-age=31536000, immutable\n", b.prefix, b.prefix, b.version, b.prefix)
	return b.write("_headers", []byte(headers.String()))
}

// publish swaps the finished stage in for public/. Until now the last
// successful output stays untouched.
func (b *builder) publish() error {
	if err := os.RemoveAll("public"); err != nil {
		return err
	}
	return os.Rename(b.stage, "public")
}
