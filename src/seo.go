package main

import (
	"encoding/json"
	"html/template"
	"strings"
)

// structuredData is the page's schema.org JSON-LD. json.Marshal escapes <, > and &,
// so the result cannot close its <script> element.
func structuredData(p Page) template.JS {
	author := map[string]any{"@type": "Person", "name": p.Site.Author, "url": p.Site.About, "image": p.Site.URL + "/static/avatar.png"}
	if len(p.Site.SameAs) > 0 {
		author["sameAs"] = p.Site.SameAs
	}
	lang := "zh-CN"
	if p.Lang != nil {
		lang = p.Lang.HTML
	}
	siteTitle := p.UI.Title
	if siteTitle == "" {
		siteTitle = p.Site.Title
	}
	data := map[string]any{"@context": "https://schema.org", "inLanguage": lang}
	switch p.Kind {
	case "home":
		url := p.Site.URL + "/"
		if p.Path != "" {
			url = p.Site.URL + p.Path
		}
		data["@type"] = "WebSite"
		data["name"] = siteTitle
		data["url"] = url
		data["description"] = p.Description
		data["author"] = author
	case "about":
		url := p.Site.URL + p.Path
		data["@type"] = "ProfilePage"
		data["name"] = p.Title
		data["description"] = p.Description
		data["url"] = url
		data["mainEntity"] = author
	case "post":
		url := p.Site.URL + p.Post.Path
		data["@type"] = "BlogPosting"
		data["headline"] = p.Post.Title
		data["description"] = p.Post.Description
		data["url"] = url
		data["mainEntityOfPage"] = url
		data["datePublished"] = p.Post.Date
		data["dateModified"] = p.Post.Modified()
		data["author"] = author
		data["publisher"] = author
		if keywords := append([]string{p.Post.Tag}, p.Post.Tags...); strings.Join(keywords, "") != "" {
			data["keywords"] = strings.Trim(strings.Join(keywords, ", "), ", ")
		}
		if p.Post.Category != nil {
			data["articleSection"] = p.Post.Category.Name
		}
	default:
		return ""
	}
	b, err := json.Marshal(data)
	if err != nil {
		panic(err) // only strings, slices and maps: cannot fail
	}
	return template.JS(b)
}
