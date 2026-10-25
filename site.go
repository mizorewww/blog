package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"github.com/yuin/goldmark"
	"golang.org/x/net/html"
)

// Lang is one language edition of the site. Chinese lives at the root, the
// others under /<code>/; a post in content/posts/<code>/ belongs to that edition
// and is the translation of the root post with the same slug.
type Lang struct {
	Code, Base, HTML, OG string
	UI                   UI
}

// UI holds the interface text of one edition. Printf verbs take counts.
type UI struct {
	Description, Skip, Nav, Home, About, Tags, Search, Categories, AllPosts, Minutes, Read, Updated, TOC string
	Previous, Next, Adjacent, Elsewhere, Theme, Top, Empty, NotFound, NotFoundDek, BackHome              string
	Stats, Count, Category, Tag, TagsTitle, SearchLabel, SearchFound, SearchNone, Copy                   string
	History, Commits, Source, License, LicenseText, LicenseNote                                          string
	Switch, SwitchLang                                                                                   string
	NotFoundTitle, LiveChart, Moved, MovedTo                                                             string
}

// markdowns holds one renderer per edition, keyed by Lang.Code.
var markdowns = map[string]goldmark.Markdown{}

func init() {
	for _, l := range languages {
		markdowns[l.Code] = newMarkdown(l.UI)
	}
}

// markdown is the edition's renderer; a post outside any edition uses the default one.
func (l *Lang) markdown() goldmark.Markdown {
	if l == nil {
		return markdowns[languages[0].Code]
	}
	return markdowns[l.Code]
}

var languages = []Lang{
	{"zh", "", "zh-CN", "zh_CN", UI{
		Skip: "跳到正文", Nav: "站点", Home: "所有文章", About: "关于", Tags: "标签", Search: "搜索", Categories: "分类",
		AllPosts: "← 所有文章", Minutes: "%d 分钟", Read: "%d 分钟阅读", Updated: "更新于 %s", TOC: "目录",
		Previous: "← 上一篇", Next: "下一篇 →", Adjacent: "相邻文章", Elsewhere: "其他地方", Theme: "切换深浅色", Top: "回到顶部",
		Empty: "还没有文章。第一篇，很快见。", NotFound: "这页，还没有写。", NotFoundDek: "链接可能变了，也可能从未存在。", BackHome: "← 回到首页",
		Stats: "%d 篇文章 · %d 个分类 · %d 个标签 · %s字", Count: "%d 篇", Category: "分类", Tag: "标签", TagsTitle: "分类与标签",
		SearchLabel: "搜索标题、正文和标签", SearchFound: "找到 %d 篇", SearchNone: "没有找到相关文章",
		History: "修改", Commits: "%d 次提交，最近一次在 %s", Source: "源文件", License: "许可",
		LicenseText: "除另有说明，本文采用 ", LicenseNote: " 许可。转载或改编请署名、非商业使用，并以相同方式共享。",
		Switch: "EN", SwitchLang: "en",
		NotFoundTitle: "页面未找到", LiveChart: "实时图表", Moved: "已移动", MovedTo: "这篇文章已移动到 ",
	}},
	{"en", "/en", "en", "en_US", UI{
		Description: "Notes on code, tools, and keeping things simple.",
		Skip:        "Skip to content", Nav: "Site", Home: "All posts", About: "About", Tags: "Tags", Search: "Search", Categories: "Categories",
		AllPosts: "← All posts", Minutes: "%d min", Read: "%d min read", Updated: "Updated %s", TOC: "Contents",
		Previous: "← Previous", Next: "Next →", Adjacent: "More posts", Elsewhere: "Elsewhere", Theme: "Toggle dark mode", Top: "Back to top",
		Empty: "No posts yet.", NotFound: "Nothing here yet.", NotFoundDek: "The link may have changed, or never existed.", BackHome: "← Home",
		Stats: "%d posts · %d categories · %d tags · %s words", Count: "%d posts", Category: "Category", Tag: "Tag", TagsTitle: "Categories & tags",
		SearchLabel: "Search titles, text and tags", SearchFound: "%d found", SearchNone: "Nothing found",
		History: "History", Commits: "%d commits, latest on %s", Source: "Source", License: "License",
		LicenseText: "Unless noted otherwise, this post is licensed under ", LicenseNote: ". Please attribute, use non-commercially, and share adaptations alike.",
		Switch: "中文", SwitchLang: "zh-CN",
		NotFoundTitle: "Page not found", LiveChart: "Live chart", Moved: "Moved", MovedTo: "This post has moved to ",
	}},
}

// Term is a category or tag with the posts filed under it.
type Term struct {
	Name, Slug, Path string
	Posts            []*Post
}

// termSlug matches the old blog's github-slugger URLs: lowercase, spaces to
// hyphens, punctuation other than - and _ dropped, letters of any script kept.
func termSlug(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsMark(r) || r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteByte('-')
		}
	}
	return b.String()
}

// collectTerms groups posts (newest first) by name; terms sort by post count, then name.
// Two different names with one slug would share a page, so they fail the build.
func collectTerms(posts []*Post, base, kind string, names func(*Post) []string) ([]*Term, error) {
	bySlug := map[string]*Term{}
	var terms []*Term
	for _, p := range posts {
		for _, name := range names(p) {
			slug := termSlug(name)
			if slug == "" {
				continue
			}
			t := bySlug[slug]
			if t == nil {
				t = &Term{Name: name, Slug: slug, Path: base + "/" + kind + "/" + slug + "/"}
				bySlug[slug] = t
				terms = append(terms, t)
			} else if t.Name != name {
				return nil, fmt.Errorf("%s: %s %q and %q share the URL %s; use one spelling", p.File, kind, name, t.Name, t.Path)
			}
			if len(t.Posts) == 0 || t.Posts[len(t.Posts)-1] != p {
				t.Posts = append(t.Posts, p)
			}
		}
	}
	sort.SliceStable(terms, func(i, j int) bool {
		if len(terms[i].Posts) != len(terms[j].Posts) {
			return len(terms[i].Posts) > len(terms[j].Posts)
		}
		return terms[i].Slug < terms[j].Slug
	})
	return terms, nil
}

// Commit is one change to a post's source, newest first.
type Commit struct{ Hash, Short, Date, Subject string }

// gitHistory lists the commits that touched path; outside a repository it is empty.
func gitHistory(path string) []Commit {
	out, err := exec.Command("git", "log", "--follow", "--format=%H%x1f%cs%x1f%s", "--", filepath.ToSlash(path)).Output()
	if err != nil {
		return nil
	}
	var commits []Commit
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.SplitN(line, "\x1f", 3)
		if len(parts) == 3 && len(parts[0]) >= 7 {
			commits = append(commits, Commit{parts[0], parts[0][:7], parts[1], parts[2]})
		}
	}
	return commits
}

// gitHead is the commit being built, shown in the footer.
func gitHead() string {
	out, err := exec.Command("git", "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// contentText is the readable text of rendered HTML, for the search index.
func contentText(content string) string {
	var b strings.Builder
	skip := 0
	z := html.NewTokenizer(strings.NewReader(content))
	for {
		switch z.Next() {
		case html.ErrorToken:
			return strings.Join(strings.Fields(b.String()), " ")
		case html.StartTagToken:
			if name, _ := z.TagName(); string(name) == "svg" || string(name) == "math" || string(name) == "button" {
				skip++
			}
		case html.EndTagToken:
			if name, _ := z.TagName(); skip > 0 && (string(name) == "svg" || string(name) == "math" || string(name) == "button") {
				skip--
			}
		case html.TextToken:
			if skip == 0 {
				b.Write(z.Text())
				b.WriteByte(' ')
			}
		}
	}
}
