package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"golang.org/x/net/html"
)

// pageLinks is what one HTML file links to and which fragment ids it defines.
type pageLinks struct {
	links []string
	ids   map[string]bool
}

// checkLinks fails the build when a page links to a file or #fragment inside
// the site that the build did not write, e.g. a renamed post or heading.
// Links outside the site's URL are not checked.
func checkLinks(stage, siteURL, prefix string) error {
	pages := map[string]*pageLinks{} // by URL path, e.g. /posts/x/
	err := filepath.WalkDir(stage, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || filepath.Ext(name) != ".html" {
			return err
		}
		rel, err := filepath.Rel(stage, name)
		if err != nil {
			return err
		}
		p, err := readPageLinks(name)
		if err != nil {
			return err
		}
		pages["/"+strings.TrimSuffix(filepath.ToSlash(rel), "index.html")] = p
		return nil
	})
	if err != nil {
		return err
	}
	var problems []error
	for from, p := range pages {
		for _, link := range p.links {
			target, fragment, ok := localTarget(from, link, siteURL, prefix)
			if !ok {
				continue
			}
			if target == from {
				if fragment != "" && !p.ids[fragment] {
					problems = append(problems, fmt.Errorf("%s links to missing #%s", from, fragment))
				}
				continue
			}
			file := filepath.Join(stage, filepath.FromSlash(strings.TrimPrefix(target, "/")))
			if strings.HasSuffix(target, "/") {
				file = filepath.Join(file, "index.html")
			}
			if info, err := os.Stat(file); err != nil || info.IsDir() {
				problems = append(problems, fmt.Errorf("%s links to missing %s", from, link))
				continue
			}
			if q := pages[target]; fragment != "" && q != nil && !q.ids[fragment] {
				problems = append(problems, fmt.Errorf("%s links to missing %s", from, link))
			}
		}
	}
	return errors.Join(problems...)
}

// localTarget resolves a link on page from to a path inside the site, without
// the deployment prefix. ok is false for links that leave the site.
func localTarget(from, link, siteURL, prefix string) (target, fragment string, ok bool) {
	u, err := url.Parse(link)
	if err != nil {
		return "", "", false
	}
	fragment = u.Fragment
	switch {
	case u.Scheme == "" && u.Host == "" && u.Path == "":
		return from, fragment, true // #fragment on the same page
	case u.Scheme != "" || u.Host != "":
		if !strings.HasPrefix(link, siteURL+"/") {
			return "", "", false
		}
		u.Path = prefix + strings.TrimPrefix(u.Path, strings.TrimPrefix(siteURL, u.Scheme+"://"+u.Host))
	case !strings.HasPrefix(u.Path, "/"):
		dir := from
		if !strings.HasSuffix(dir, "/") {
			dir = path.Dir(dir) + "/"
		}
		u.Path = prefix + path.Join(dir, u.Path)
		if strings.HasSuffix(link, "/") {
			u.Path += "/"
		}
	}
	if !strings.HasPrefix(u.Path, prefix+"/") {
		return "", "", false
	}
	return strings.TrimPrefix(u.Path, prefix), fragment, true
}

func readPageLinks(name string) (*pageLinks, error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	p := &pageLinks{ids: map[string]bool{}}
	z := html.NewTokenizer(f)
	for {
		switch z.Next() {
		case html.ErrorToken:
			if z.Err() == io.EOF {
				return p, nil
			}
			return nil, fmt.Errorf("%s: %w", name, z.Err())
		case html.StartTagToken, html.SelfClosingTagToken:
			_, hasAttr := z.TagName()
			for hasAttr {
				var key, value []byte
				key, value, hasAttr = z.TagAttr()
				switch string(key) {
				case "id":
					p.ids[string(value)] = true
				case "href", "src":
					p.links = append(p.links, string(value))
				case "srcset":
					for _, candidate := range strings.Split(string(value), ",") {
						if fields := strings.Fields(candidate); len(fields) > 0 {
							p.links = append(p.links, fields[0])
						}
					}
				}
			}
		}
	}
}
