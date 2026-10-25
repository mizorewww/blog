package main

import (
	"net/url"
	"strings"
)

// profileName labels a sameAs link in the footer.
func profileName(link string) string {
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
}

type Site struct {
	Title, Author, Description, URL, About, Repo, Email string
	SameAs                                              []string
	Redirects                                           []Redirect
	Commit                                              string `json:"-"`
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
