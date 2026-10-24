package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/yuin/goldmark/ast"
)

type imageInfo struct {
	Path          string
	Width, Height int
	Small         *struct {
		Path  string
		Width int
	}
}

type imagePipeline struct {
	stage, base string
	processed   map[string]imageInfo
}

// Image paths are relative to the Markdown source, or rooted at /static/.
func imageSource(document, destination string) (string, error) {
	u, err := url.Parse(destination)
	if err != nil {
		return "", err
	}
	if u.Scheme == "http" || u.Scheme == "https" || u.Host != "" {
		return "", nil
	}
	if u.Scheme != "" {
		return "", fmt.Errorf("unsupported image URL: %s", destination)
	}
	source := filepath.Join(filepath.Dir(document), filepath.FromSlash(u.Path))
	if strings.HasPrefix(u.Path, "/") {
		source = filepath.FromSlash(strings.TrimPrefix(u.Path, "/"))
	}
	source, err = filepath.EvalSymlinks(source)
	if err != nil {
		return "", err
	}
	source, err = filepath.Abs(source)
	if err != nil {
		return "", err
	}
	for _, root := range []string{"content", "static"} {
		allowed, err := filepath.EvalSymlinks(root)
		if err != nil {
			continue
		}
		allowed, err = filepath.Abs(allowed)
		if err != nil {
			return "", err
		}
		rel, err := filepath.Rel(allowed, source)
		if err == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return source, nil
		}
	}
	return "", fmt.Errorf("image must be inside content/ or static/: %s", destination)
}

// publish copies a file to /images/ under its content hash, so it never needs
// the CSS version, and returns its absolute URL, which also works in the RSS feed.
func (p *imagePipeline) publish(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	relative := fmt.Sprintf("/images/%x%s", sha256.Sum256(data), strings.ToLower(filepath.Ext(path)))
	target := filepath.Join(p.stage, filepath.FromSlash(relative[1:]))
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return "", err
	}
	return p.base + relative, os.WriteFile(target, data, 0644)
}

func (p *imagePipeline) hook(document string) func(*ast.Image) error {
	count := 0
	return func(node *ast.Image) error {
		count++
		node.SetAttributeString("decoding", "async")
		if count > 1 {
			node.SetAttributeString("loading", "lazy")
		} else {
			// The first image is often the largest paint on a phone.
			node.SetAttributeString("fetchpriority", "high")
		}
		source, err := imageSource(document, string(node.Destination))
		if err != nil {
			return fmt.Errorf("%s: image %q: %w", document, node.Destination, err)
		}
		if source == "" {
			return nil
		} // Remote images stay remote; no build-time downloads.
		info, ok := p.processed[source]
		if !ok {
			info.Path = source
			if !strings.EqualFold(filepath.Ext(source), ".svg") {
				cmd := exec.Command("uv", "run", "--script", "scripts/prepare-image.py", source, ".cache/images")
				cmd.Stderr = os.Stderr
				output, err := cmd.Output()
				if err != nil {
					return fmt.Errorf("%s: optimize image (requires uv): %w", source, err)
				}
				if err := json.Unmarshal(output, &info); err != nil {
					return err
				}
			}
			if info.Path, err = p.publish(info.Path); err != nil {
				return err
			}
			if info.Small != nil {
				if info.Small.Path, err = p.publish(info.Small.Path); err != nil {
					return err
				}
			}
			if p.processed == nil {
				p.processed = make(map[string]imageInfo)
			}
			p.processed[source] = info
		}
		destination := info.Path
		if original, err := url.Parse(string(node.Destination)); err == nil && original.Fragment != "" {
			destination += "#" + original.EscapedFragment()
		}
		node.Destination = []byte(destination)
		if info.Width > 0 && info.Height > 0 {
			node.SetAttributeString("width", strconv.Itoa(info.Width))
			node.SetAttributeString("height", strconv.Itoa(info.Height))
		}
		if info.Small != nil {
			node.SetAttributeString("srcset", fmt.Sprintf("%s %dw, %s %dw", info.Small.Path, info.Small.Width, info.Path, info.Width))
			node.SetAttributeString("sizes", "(max-width: 760px) calc(100vw - 64px), 704px")
		}
		return nil
	}
}
