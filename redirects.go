package main

import (
	"fmt"
	"html/template"
	"net/url"
	"path/filepath"
	"strings"
)

// Redirect sends an old path (optionally ending in a /* splat) to a new path or URL.
type Redirect struct{ From, To string }

var redirectPage = template.Must(template.New("redirect").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>已移动 — {{.Title}}</title>
<meta name="robots" content="noindex"><link rel="canonical" href="{{.To}}">
<meta http-equiv="refresh" content="0; url={{.To}}"></head>
<body><p>这篇文章已移动到 <a href="{{.To}}">{{.To}}</a>。</p></body></html>
`))

// escapePath percent-encodes each segment, matching how browsers request
// /zh/技术/x/ and how the old feed wrote its GUIDs.
func escapePath(path string) string {
	segments := strings.Split(path, "/")
	for i, s := range segments {
		if s != "*" {
			segments[i] = url.PathEscape(s)
		}
	}
	return strings.Join(segments, "/")
}

func validAlias(alias string) error {
	clean := filepath.ToSlash(filepath.Clean(alias)) + "/"
	switch {
	case !strings.HasPrefix(alias, "/") || !strings.HasSuffix(alias, "/") || clean != alias:
		return fmt.Errorf("alias %q must be a clean path that starts and ends with /", alias)
	case alias == "/" || strings.HasPrefix(alias, "/posts/") || strings.HasPrefix(alias, "/static/") || strings.HasPrefix(alias, "/images/"):
		return fmt.Errorf("alias %q would replace a generated page", alias)
	}
	return nil
}

// writeRedirects emits Cloudflare Pages _redirects (real 301s, first match wins)
// and an HTML redirect at every alias so moved posts also survive other hosts.
func writeRedirects(site Site, prefix string, posts []Post, write func(string, []byte) error) error {
	var rules strings.Builder
	seen := map[string]string{}
	for _, p := range posts {
		for _, alias := range p.Aliases {
			if err := validAlias(alias); err != nil {
				return fmt.Errorf("%s: %w", p.Slug, err)
			}
			if other, ok := seen[alias]; ok {
				return fmt.Errorf("alias %s is claimed by both %s and %s", alias, other, p.Slug)
			}
			seen[alias] = p.Slug
			// Cloudflare does not document whether rules match encoded or decoded
			// paths, so list both; otherwise the /zh/* catch-all would win.
			forms := []string{prefix + escapePath(alias)}
			if raw := prefix + alias; raw != forms[0] {
				forms = append(forms, raw)
			}
			for _, from := range forms {
				fmt.Fprintf(&rules, "%s %s 301\n%s %s 301\n", from, prefix+p.Path, strings.TrimSuffix(from, "/"), prefix+p.Path)
			}
			var page strings.Builder
			if err := redirectPage.Execute(&page, map[string]string{"Title": p.Title, "To": site.URL + p.Path}); err != nil {
				return err
			}
			if err := write(filepath.Join(filepath.FromSlash(strings.TrimPrefix(alias, "/")), "index.html"), []byte(page.String())); err != nil {
				return err
			}
		}
	}
	for _, r := range site.Redirects {
		to := r.To
		if strings.HasPrefix(to, "/") {
			to = prefix + to
		}
		fmt.Fprintf(&rules, "%s %s 301\n", prefix+escapePath(r.From), to)
	}
	if rules.Len() == 0 {
		return nil
	}
	return write("_redirects", []byte(rules.String()))
}
