package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeCacheAndCompression(t *testing.T) {
	root := t.TempDir()
	asset := "/static/0123456789abcdef/style.css"
	for name, body := range map[string]string{"index.html": "<h1>Hello</h1>", "404.html": "missing", strings.TrimPrefix(asset, "/"): strings.Repeat("body{color:red}", 100)} {
		target := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	handler := serveSite(root)
	request := func(method, path string, headers map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	plain := request("GET", asset, nil)
	zipped := request("GET", asset, map[string]string{"Accept-Encoding": "gzip"})
	if zipped.Code != 200 || zipped.Header().Get("Content-Encoding") != "gzip" || zipped.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("invalid compressed response: %v", zipped.Result())
	}
	reader, err := gzip.NewReader(zipped.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil || string(decoded) != plain.Body.String() {
		t.Fatal("gzip round trip failed")
	}
	if plain.Header().Get("ETag") == zipped.Header().Get("ETag") {
		t.Fatal("representations must have distinct ETags")
	}
	if !strings.Contains(plain.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("versioned assets must be immutable")
	}
	for _, encoding := range []string{"", "gzip"} {
		original := request("GET", "/", map[string]string{"Accept-Encoding": encoding})
		cached := request("GET", "/", map[string]string{"Accept-Encoding": encoding, "If-None-Match": original.Header().Get("ETag")})
		if cached.Code != 304 || cached.Body.Len() != 0 || original.Header().Get("Cache-Control") != "no-cache" {
			t.Fatal("HTML must revalidate and return 304 when unchanged")
		}
	}
	old := request("GET", "/", nil).Header().Get("ETag")
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("updated"), 0644); err != nil {
		t.Fatal(err)
	}
	changed := request("GET", "/", map[string]string{"If-None-Match": old})
	if changed.Code != 200 || changed.Body.String() != "updated" || changed.Header().Get("ETag") == old {
		t.Fatal("updated HTML must invalidate its ETag")
	}
	head := request("HEAD", asset, nil)
	if head.Code != 200 || head.Body.Len() != 0 {
		t.Fatal("invalid HEAD")
	}
	partial := request("GET", asset, map[string]string{"Range": "bytes=0-3"})
	if partial.Code != http.StatusPartialContent || partial.Body.String() != "body" {
		t.Fatal("range requests failed")
	}
	for _, path := range []string{"/missing", "/static/0123456789abcdef/missing.css"} {
		missing := request("GET", path, nil)
		if missing.Code != 404 || missing.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing resources must not be cached")
		}
	}
	if request("POST", "/", nil).Code != 405 {
		t.Fatal("unexpected method accepted")
	}
}

func TestGzipNegotiation(t *testing.T) {
	for header, want := range map[string]bool{"": false, "br": false, "gzip": true, "br, gzip;q=0.5": true, "gzip;q=0": false, "gzip;q=0, *;q=1": false, "*;q=0.5": true, "gzip;q=oops": false} {
		if got := acceptsGzip(header); got != want {
			t.Errorf("%q: got %v, want %v", header, got, want)
		}
	}
}

func TestAssetVersion(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "style.css")
	if err := os.WriteFile(file, []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	first, err := assetVersion(root)
	if err != nil {
		t.Fatal(err)
	}
	again, err := assetVersion(root)
	if err != nil || first != again {
		t.Fatal("version is not deterministic")
	}
	if err = os.WriteFile(file, []byte("second"), 0644); err != nil {
		t.Fatal(err)
	}
	second, err := assetVersion(root)
	if err != nil || first == second {
		t.Fatal("content change did not invalidate assets")
	}
}
