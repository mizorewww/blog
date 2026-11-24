package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var versionedAsset = regexp.MustCompile(`^/(static/[0-9a-f]{16}/|images/[0-9a-f]{64}\.|widgets/[^/]+-[0-9a-f]{12}/)`)

func serveSite(root string) http.Handler { return serveSitePrefix(root, "") }

func serveSitePrefix(root, prefix string) http.Handler {
	prefix = strings.TrimRight(prefix, "/")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		reqPath := r.URL.Path
		if prefix != "" {
			if reqPath == prefix {
				target := *r.URL
				target.Path += "/"
				target.RawPath = ""
				http.Redirect(w, r, target.String(), http.StatusMovedPermanently)
				return
			}
			if !strings.HasPrefix(reqPath, prefix+"/") {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Cache-Control", "no-store")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			reqPath = strings.TrimPrefix(reqPath, prefix)
		}
		name := filepath.Join(root, filepath.FromSlash(path.Clean("/"+reqPath)))
		info, err := os.Stat(name)
		if err == nil && info.IsDir() {
			if !strings.HasSuffix(reqPath, "/") {
				target := *r.URL
				target.Path += "/"
				target.RawPath = ""
				http.Redirect(w, r, target.String(), http.StatusMovedPermanently)
				return
			}
			name = filepath.Join(name, "index.html")
			info, err = os.Stat(name)
		}
		if err != nil || info.IsDir() {
			body := notFoundPage(root, reqPath)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNotFound)
			if r.Method != http.MethodHead {
				_, _ = w.Write(body)
			}
			return
		}
		body, err := os.ReadFile(name)
		if err != nil {
			http.Error(w, "cannot read file", http.StatusInternalServerError)
			return
		}
		contentType := mime.TypeByExtension(filepath.Ext(name))
		if contentType == "" {
			contentType = http.DetectContentType(body)
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if versionedAsset.MatchString(reqPath) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasPrefix(contentType, "text/") || strings.Contains(contentType, "xml") || strings.Contains(contentType, "json") || strings.Contains(contentType, "javascript") {
			w.Header().Set("Vary", "Accept-Encoding")
			if acceptsGzip(r.Header.Get("Accept-Encoding")) {
				var compressed bytes.Buffer
				writer := gzip.NewWriter(&compressed)
				_, _ = writer.Write(body)
				_ = writer.Close()
				body = compressed.Bytes()
				w.Header().Set("Content-Encoding", "gzip")
			}
		}
		w.Header().Set("ETag", fmt.Sprintf(`"%x"`, sha256.Sum256(body)))
		http.ServeContent(w, r, filepath.Base(name), info.ModTime(), bytes.NewReader(body))
	})
}

// notFoundPage is the 404.html nearest to the request, as Cloudflare Pages picks it.
func notFoundPage(root, request string) []byte {
	for dir := path.Dir(path.Clean("/" + request)); ; dir = path.Dir(dir) {
		if body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(dir), "404.html")); err == nil {
			return body
		}
		if dir == "/" {
			return nil
		}
	}
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, item := range strings.Split(header, ",") {
		parts := strings.Split(strings.TrimSpace(item), ";")
		name := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, param := range parts[1:] {
			if value, ok := strings.CutPrefix(strings.TrimSpace(param), "q="); ok {
				parsed, err := strconv.ParseFloat(value, 64)
				quality = 0
				if err == nil && parsed > 0 && parsed <= 1 {
					quality = parsed
				}
			}
		}
		if name == "gzip" {
			return quality > 0
		}
		if name == "*" {
			wildcard = quality > 0
		}
	}
	return wildcard
}
