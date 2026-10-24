package main

import (
	"encoding/json"
	"html/template"
	"strconv"
	"strings"

	"github.com/yuin/goldmark/ast"
)

// ShareImage is the og:image of a page: a post's "image", else its first image, else static/og.png.
type ShareImage struct {
	URL, Alt      string
	Width, Height int
}

func defaultShareImage(site Site) ShareImage {
	return ShareImage{URL: site.URL + "/static/og.png", Alt: site.Title, Width: 1280, Height: 640}
}

// firstImage wraps an image hook and remembers the first absolute image URL it produced.
func firstImage(hook func(*ast.Image) error, src []byte, into *ShareImage) func(*ast.Image) error {
	return func(n *ast.Image) error {
		if err := hook(n); err != nil || into.URL != "" {
			return err
		}
		destination := string(n.Destination)
		if !strings.HasPrefix(destination, "https://") && !strings.HasPrefix(destination, "http://") {
			return nil
		}
		*into = ShareImage{URL: destination, Alt: plainText(n, src)}
		for attr, size := range map[string]*int{"width": &into.Width, "height": &into.Height} {
			if v, ok := n.AttributeString(attr); ok {
				*size, _ = strconv.Atoi(v.(string))
			}
		}
		return nil
	}
}

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
	data := map[string]any{"@context": "https://schema.org", "inLanguage": lang}
	switch p.Kind {
	case "home":
		data["@type"] = "WebSite"
		data["name"] = p.Site.Title
		data["url"] = p.Site.URL + "/"
		data["description"] = p.Description
		data["author"] = author
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
		data["image"] = p.Image.URL
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
