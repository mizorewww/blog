package main

import (
	"encoding/xml"
	"strings"
	"time"
)

// newestOf is the latest edit among posts. Dates come from content, not the
// clock, so unchanged content builds identical files.
func newestOf(posts []*Post) string {
	newest := ""
	for _, p := range posts {
		newest = max(newest, p.Modified())
	}
	return newest
}

// feed queues a full-text RSS feed at path.
func (b *builder) feed(lang *Lang, path, title, description string, posts []*Post) {
	f := Feed{Version: "2.0", Channel: Channel{Title: title, Link: b.site.URL + strings.TrimSuffix(path, "feed.xml"), Description: description, Language: lang.HTML,
		Self: AtomLink{Href: b.site.URL + path, Rel: "self", Type: "application/rss+xml"}}}
	if newest := newestOf(posts); newest != "" {
		updated, _ := time.Parse(time.DateOnly, newest)
		f.Channel.BuildDate = updated.Format(time.RFC1123Z)
	}
	for _, p := range posts {
		date, _ := time.Parse(time.DateOnly, p.Date)
		link := b.site.URL + p.Path
		guid := link
		if len(p.Aliases) > 0 {
			guid = b.site.URL + escapePath(p.Aliases[0]) // keeps feed readers from re-announcing moved posts
		}
		f.Channel.Items = append(f.Channel.Items, Item{Title: p.Title, Link: link, Description: string(p.Content), Category: p.Tag, Date: date.Format(time.RFC1123Z), GUID: guid})
	}
	b.feeds[strings.TrimPrefix(path, "/")] = f
}

func (b *builder) writeFeeds() error {
	for name, f := range b.feeds {
		if err := b.writeXML(name, f); err != nil {
			return err
		}
	}
	return nil
}

func (b *builder) writeSitemap() error { return b.writeXML("sitemap.xml", b.sitemap) }

func (b *builder) writeXML(name string, v any) error {
	data, err := xml.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return b.write(name, append([]byte(xml.Header), data...))
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
