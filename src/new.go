package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"
)

// newPost scaffolds an article without building the site or replacing files.
func newPost(args []string, out io.Writer) error {
	now := time.Now()
	flags := flag.NewFlagSet("new", flag.ContinueOnError)
	flags.SetOutput(out)
	title := flags.String("title", "", "article title (or use one positional argument)")
	slug := flags.String("slug", "", "URL slug: lowercase letters, numbers and hyphens")
	description := flags.String("description", "在这里填写文章摘要。", "article summary")
	tag := flags.String("tag", "", "optional category")
	date := flags.String("date", now.Format(time.DateOnly), "publication date: YYYY-MM-DD")
	flags.Usage = func() {
		fmt.Fprintln(out, "Usage: go run ./src new [flags] \"文章标题\"\n\nFlags must precede the title. Edit templates/post.md.tmpl to customize the body.")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() > 1 || (flags.NArg() == 1 && *title != "") {
		return fmt.Errorf("provide exactly one title, either -title or a quoted argument")
	}
	if flags.NArg() == 1 {
		*title = flags.Arg(0)
	}
	meta := PostMetadata{Title: strings.TrimSpace(*title), Description: strings.TrimSpace(*description), Date: *date, Tag: strings.TrimSpace(*tag)}
	if meta.Title == "" || meta.Description == "" {
		return fmt.Errorf("title and description must not be empty")
	}
	if _, err := time.Parse(time.DateOnly, meta.Date); err != nil {
		return fmt.Errorf("invalid date: %w", err)
	}
	if *slug == "" {
		var words strings.Builder
		for _, r := range strings.ToLower(meta.Title) {
			if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
				words.WriteRune(r)
			} else {
				words.WriteByte(' ')
			}
		}
		*slug = strings.Join(strings.Fields(words.String()), "-")
		if *slug == "" {
			*slug = "post-" + now.Format("20060102-150405")
		}
	}
	if !slugPattern.MatchString(*slug) {
		return fmt.Errorf("invalid slug %q: use lowercase letters, numbers and single hyphens", *slug)
	}
	tmpl, err := template.ParseFiles("templates/post.md.tmpl")
	if err != nil {
		return err
	}
	metadata, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	var body bytes.Buffer
	if err = tmpl.Execute(&body, struct {
		Metadata string
		PostMetadata
	}{string(metadata), meta}); err != nil {
		return err
	}
	dir := filepath.Join("content", "posts")
	if err = os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	path := filepath.Join(dir, *slug+".md")
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if errors.Is(err, os.ErrExist) {
		return fmt.Errorf("%s already exists; choose a different -slug", path)
	}
	if err != nil {
		return err
	}
	_, writeErr := f.Write(body.Bytes())
	closeErr := f.Close()
	if err = errors.Join(writeErr, closeErr); err != nil {
		_ = os.Remove(path)
		return err
	}
	fmt.Fprintf(out, "Created %s\nEdit the summary and body, then run go run ./src to build.\n", path)
	return nil
}
