package main

import (
	"fmt"
	"html"
	"os"
	"strings"

	"github.com/yuin/goldmark/ast"
)

// A ```video fence is a short, silent clip that shows a process better than
// a still: an animation of a surface being swept, a model's output over
// time. Lines are
//
//	clip.mp4 | what the clip shows (its accessible name)
//	poster.jpg
//
// Both go through the image pipeline as ast.Image children: the poster is
// optimized and sized like any picture, the clip is published as it is.
// Nothing of the clip loads until it plays (preload="none"), so a page with
// one costs only its poster. With autoplay="true", templates/js/video.js plays
// it, muted and looping, while it is on screen, unless the reader prefers
// reduced motion; without JavaScript the browser's own controls play it.

var videoAttributes = []string{"title", "note", "autoplay"}

// videoLimit is the largest file Cloudflare Pages serves.
const videoLimit = 25 << 20

func videoImage(line string) string {
	path, _, _ := strings.Cut(line, "|")
	return strings.TrimSpace(path)
}

func isVideo(path string) bool {
	path = strings.ToLower(path)
	return strings.HasSuffix(path, ".mp4") || strings.HasSuffix(path, ".webm")
}

func renderVideo(info string, lines []string, images []*ast.Image) (string, error) {
	attrs, err := blockAttributes(info, videoAttributes)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(attrs["title"]) == "" {
		return "", fmt.Errorf("needs a title")
	}
	autoplay, ok := attrs["autoplay"]
	if ok && autoplay != "true" && autoplay != "false" {
		return "", fmt.Errorf(`autoplay is "true" or "false"`)
	}
	var kept []string
	for _, line := range lines {
		if strings.TrimSpace(line) != "" {
			kept = append(kept, line)
		}
	}
	if len(kept) != 2 || len(images) != 2 {
		return "", fmt.Errorf("write two lines: clip.mp4 | what it shows, then the poster image")
	}
	clip, poster := images[0], images[1]
	if strings.Contains(videoImage(kept[0]), "//") {
		return "", fmt.Errorf("the clip must be a file under content/ or static/: the page requests nothing from other sites")
	}
	_, alt, _ := strings.Cut(kept[0], "|")
	alt = strings.TrimSpace(alt)
	if !isVideo(videoImage(kept[0])) || alt == "" {
		return "", fmt.Errorf("the first line is clip.mp4 (or .webm) | what the clip shows")
	}
	if isVideo(videoImage(kept[1])) || strings.Contains(kept[1], "|") {
		return "", fmt.Errorf("the second line is the poster image alone")
	}
	w, h := imageSize(poster)
	if w == 0 || h == 0 {
		return "", fmt.Errorf("the poster has no pixel size; use a JPEG, PNG or WebP")
	}
	title := html.EscapeString(attrs["title"])
	var b strings.Builder
	fmt.Fprintf(&b, `<figure class="video"><figcaption>%s</figcaption>`, title)
	fmt.Fprintf(&b, `<video src="%s" poster="%s" width="%d" height="%d" controls muted playsinline preload="none" aria-label="%s"`,
		html.EscapeString(string(clip.Destination)), html.EscapeString(string(poster.Destination)), w, h, html.EscapeString(alt))
	if autoplay == "true" {
		b.WriteString(` loop data-autoplay`)
	}
	b.WriteString(`></video>`)
	if note := attrs["note"]; note != "" {
		fmt.Fprintf(&b, `<p class="figure-note">%s</p>`, html.EscapeString(note))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}

// checkVideo keeps a clip within what the host serves.
func checkVideo(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() > videoLimit {
		return fmt.Errorf("%s is %d MB; a clip must stay under 25 MB (Cloudflare Pages)", path, info.Size()>>20)
	}
	return nil
}
