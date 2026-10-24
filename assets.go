package main

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// The mono faces used in page chrome are small; inlining them avoids a
// late font swap in the header, dates and tables. The italic stays a file.
var inlineFonts = []string{"maple-mono-400.woff2", "maple-mono-500.woff2"}

func inlineStyleFonts(css []byte) ([]byte, error) {
	out := string(css)
	for _, name := range inlineFonts {
		font, err := os.ReadFile(filepath.Join("static", "fonts", name))
		if err != nil {
			return nil, err
		}
		ref := `url("fonts/` + name + `")`
		if !strings.Contains(out, ref) {
			return nil, fmt.Errorf("style.css no longer references %s", ref)
		}
		out = strings.ReplaceAll(out, ref, `url(data:font/woff2;base64,`+base64.StdEncoding.EncodeToString(font)+`)`)
	}
	return []byte(out), nil
}

// One content version keeps asset URLs and relative font URLs consistent.
func assetVersion(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		fmt.Fprintf(hash, "%s\x00", filepath.ToSlash(name))
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(hash, file)
		return err
	})
	return fmt.Sprintf("%x", hash.Sum(nil))[:16], err
}

// pageFontsMarker is replaced by each page's own @font-face rules (fonts.go).
const pageFontsMarker = "/*page fonts*/"

// pageCSS is style.css, inlined into every page so the first paint needs only
// the HTML. Relative font URLs point at the versioned assets.
func pageCSS(base string) (template.CSS, error) {
	style, err := os.ReadFile(filepath.Join("static", "style.css"))
	if err != nil {
		return "", err
	}
	if style, err = inlineStyleFonts(style); err != nil {
		return "", err
	}
	css := pageFontsMarker + strings.ReplaceAll(string(style), `url("fonts/`, `url("`+base+`/fonts/`)
	return template.CSS(css), nil
}

// Keep author-linked images at their original paths; version only site assets.
func copyAssets(stage, version string) error {
	entries, err := os.ReadDir("static")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		source := filepath.Join("static", entry.Name())
		target := filepath.Join(stage, "static", entry.Name())
		if entry.Name() == "root" {
			// favicon.ico and apple-touch-icon.png are fetched from the site root by convention.
			target = stage
		}
		if entry.Name() == "fonts" || entry.Name() == "style.css" || entry.Name() == "favicon.svg" {
			target = filepath.Join(stage, "static", version, entry.Name())
		}
		if entry.IsDir() {
			if err = os.CopyFS(target, os.DirFS(source)); err != nil {
				return err
			}
		} else {
			body, err := os.ReadFile(source)
			if err != nil {
				return err
			}
			if entry.Name() == "style.css" {
				if body, err = inlineStyleFonts(body); err != nil {
					return err
				}
			}
			if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			if err = os.WriteFile(target, body, 0644); err != nil {
				return err
			}
		}
	}
	return nil
}
