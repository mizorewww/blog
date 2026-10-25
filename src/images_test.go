package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImagePipeline(t *testing.T) {
	dir := t.TempDir()
	for _, folder := range []string{"content/posts", "content/images", "static"} {
		if err := os.MkdirAll(filepath.Join(dir, folder), 0755); err != nil {
			t.Fatal(err)
		}
	}
	cwd, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>`)
	if err := os.WriteFile("content/images/图.svg", svg, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("secret.svg", svg, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "secret.svg"), "content/images/escape.svg"); err != nil {
		t.Fatal(err)
	}
	pipeline := imagePipeline{stage: "output", base: "https://example.com/notes"}
	body, _, err := render([]byte("![first](../images/%E5%9B%BE.svg)\n\n![again](../images/%E5%9B%BE.svg)\n\n![remote](https://cdn.example.com/a.jpg)"), pipeline.hook("content/posts/a.md"))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	if strings.Count(html, `src="https://example.com/notes/images/`) != 2 || strings.Count(html, `loading="lazy"`) != 2 || !strings.Contains(html, `src="https://cdn.example.com/a.jpg"`) {
		t.Fatal(html)
	}
	files, _ := filepath.Glob("output/images/*")
	if len(files) != 1 {
		t.Fatalf("expected deduplicated image: %v", files)
	}
	copied, _ := os.ReadFile(files[0])
	if string(copied) != string(svg) {
		t.Fatal("SVG changed")
	}
	for _, path := range []string{"../images/missing.png", "../../secret.svg", "../images/escape.svg", "file:///tmp/foo.jpg"} {
		if _, _, err := render([]byte("![bad]("+path+")"), pipeline.hook("content/posts/a.md")); err == nil {
			t.Fatalf("accepted %s", path)
		}
	}
	// Dimensions returned by the encoder must survive Goldmark's attribute filter.
	source, err := imageSource("content/posts/a.md", "../images/图.svg")
	if err != nil {
		t.Fatal(err)
	}
	pipeline.processed[source] = imageInfo{Path: "https://example.com/a.webp", Width: 800, Height: 600}
	body, _, err = render([]byte("![first](../images/图.svg)"), pipeline.hook("content/posts/a.md"))
	if err != nil || !strings.Contains(string(body), `width="800" height="600"`) || strings.Contains(string(body), `loading="lazy"`) {
		t.Fatalf("%s: %v", body, err)
	}
}

func TestImageCacheSkipsPython(t *testing.T) {
	dir := t.TempDir()
	cwd, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	t.Setenv("PATH", "") // uv cannot run, so only the cache can answer
	files := map[string]string{imageScript: "# script", "content/images/a.png": "png bytes", "out.webp": "webp"}
	for name, body := range files {
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	pipeline := imagePipeline{stage: "output", base: "https://example.com"}
	if _, err := pipeline.process("content/images/a.png"); err == nil {
		t.Fatal("a cold cache must run prepare-image.py")
	}
	key := sha256.Sum256([]byte("# script" + "png bytes"))
	manifest := fmt.Sprintf(`{"path":%q,"width":800,"height":600}`, filepath.Join(dir, "out.webp"))
	if err := os.MkdirAll(imageCache, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(imageCache, fmt.Sprintf("%x.json", key)), []byte(manifest), 0644); err != nil {
		t.Fatal(err)
	}
	info, err := pipeline.process("content/images/a.png")
	if err != nil || info.Width != 800 || !strings.HasPrefix(info.Path, "https://example.com/images/") {
		t.Fatalf("warm cache must answer without uv: %+v %v", info, err)
	}
}
