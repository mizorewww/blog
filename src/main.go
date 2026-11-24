package main

import (
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

func sitePrefix(urlOverride string) string {
	raw := urlOverride
	if raw == "" {
		var site Site
		if data, err := os.ReadFile("site.json"); err == nil && json.Unmarshal(data, &site) == nil {
			raw = site.URL
		}
	}
	if u, err := url.Parse(strings.TrimRight(raw, "/")); err == nil {
		return strings.TrimRight(u.Path, "/")
	}
	return ""
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "new" {
		if err := newPost(os.Args[2:], os.Stdout); err != nil {
			log.Fatal(err)
		}
		return
	}
	serve := flag.String("serve", "", "preview address, e.g. localhost:8080")
	var opts Options
	flag.StringVar(&opts.URL, "url", "", "override site URL (use http://localhost:8080 for preview)")
	flag.BoolVar(&opts.Drafts, "drafts", false, "also build draft posts")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments; use go run ./src new -h to create an article")
	}
	if err := build(opts); err != nil {
		log.Fatal(err)
	}
	if *serve != "" {
		prefix := sitePrefix(opts.URL)
		log.Printf("Preview: http://%s%s/ (re-run after editing)", *serve, prefix)
		log.Fatal(http.ListenAndServe(*serve, serveSitePrefix("public", prefix)))
	}
}
