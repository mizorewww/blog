package main

import (
	"flag"
	"log"
	"net/http"
	"os"
)

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
		log.Fatal("unexpected arguments; use go run . new -h to create an article")
	}
	if err := build(opts); err != nil {
		log.Fatal(err)
	}
	if *serve != "" {
		log.Printf("Preview: http://%s (re-run after editing)", *serve)
		log.Fatal(http.ListenAndServe(*serve, serveSite("public")))
	}
}
