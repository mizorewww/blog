package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNewPost(t *testing.T) {
	dir := t.TempDir()
	if err := os.CopyFS(filepath.Join(dir, "templates"), os.DirFS("templates")); err != nil {
		t.Fatal(err)
	}
	cwd, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	var out bytes.Buffer
	args := []string{"-slug", "hello-world", "-description", "摘要包含\"引号\"与\n换行", "-tag", "随笔", "-date", "2026-10-02", "你好，世界"}
	if err := newPost(args, &out); err != nil {
		t.Fatal(err)
	}
	path := "content/posts/hello-world.md"
	post, err := readPost(path)
	if err == nil {
		err = post.render(nil)
	}
	if err != nil || post.Title != "你好，世界" || len(post.TOC) != 3 {
		t.Fatalf("invalid generated article: %+v, %v", post, err)
	}
	before, _ := os.ReadFile(path)
	if err = newPost(args, &out); err == nil {
		t.Fatal("must refuse overwrites")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("existing article changed")
	}
	for _, args := range [][]string{{}, {"-slug", "../escape", "标题"}, {"-date", "2026-02-30", "标题"}, {"-description", " ", "标题"}, {"one", "two"}, {"-title", "one", "two"}} {
		if err = newPost(args, &out); err == nil {
			t.Fatalf("accepted invalid arguments: %v", args)
		}
	}
	if err = newPost([]string{"Hello, Go!"}, &out); err != nil {
		t.Fatal(err)
	}
	if _, err = readPost("content/posts/hello-go.md"); err != nil {
		t.Fatal(err)
	}
	if err = newPost([]string{"纯中文标题"}, &out); err != nil {
		t.Fatal(err)
	}
	matches, _ := filepath.Glob("content/posts/post-*.md")
	if len(matches) != 1 {
		t.Fatalf("expected timestamp slug, got %v", matches)
	}
	if err = newPost([]string{"-h"}, &out); err != nil || !strings.Contains(out.String(), "Usage:") {
		t.Fatal("help failed")
	}
}
