package main

import (
	"strings"
	"testing"

	"github.com/yuin/goldmark/ast"
)

// fakeImages stands in for the image pipeline: it publishes every image at
// /img/<name> with the given pixel size and a small version.
func fakeImages(width, height string, seen *[]string) func(*ast.Image) error {
	return func(node *ast.Image) error {
		*seen = append(*seen, string(node.Destination))
		node.Destination = []byte("/img/" + strings.TrimPrefix(string(node.Destination), "../images/"))
		node.SetAttributeString("width", width)
		node.SetAttributeString("height", height)
		node.SetAttributeString("srcset", "/img/small 720w, "+string(node.Destination)+" 1600w")
		node.SetAttributeString("loading", "lazy")
		return nil
	}
}

func TestFrames(t *testing.T) {
	src := "```frames title=\"兔子在哪\" q=\"the big white rabbit\" note=\"注\" cols=\"2\"\n" +
		"../images/a.jpg | 0:42 | 0.99 | 200,48,600,432 | 在 & <b>\n" +
		"../images/b.jpg | 1:40 | 0.03 | 0,0,10,10\n```\n"
	var seen []string
	body, _, err := render([]byte(src), fakeImages("800", "480", &seen))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	if len(seen) != 2 || seen[0] != "../images/a.jpg" || seen[1] != "../images/b.jpg" {
		t.Fatalf("every frame must go through the image pipeline, in order: %v", seen)
	}
	for _, want := range []string{
		`<figure class="frames" style="--cols:2;--cols-n:2"><figcaption>兔子在哪</figcaption><p class="frames-q">the big white rabbit</p><ol class="frames-strip">`,
		`<li class="in"><div class="shot"><img src="/img/a.jpg" alt="0:42 P=0.99 在 &amp; &lt;b&gt;" width="800" height="480" srcset="/img/small 720w, /img/a.jpg 1600w" loading="lazy" sizes="(max-width: 640px) 50vw, 352px">`,
		`<span class="box" style="left:25.0%;top:10.0%;width:50.0%;height:80.0%"></span>`,
		`<p class="frames-p"><span>0:42</span><b>P 0.99</b></p><span class="frames-bar" style="--p:99%"></span><p class="frames-cap">在 &amp; &lt;b&gt;</p></li>`,
		`<li class="out"><div class="shot"><img src="/img/b.jpg"`,
		`<p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	if strings.Count(html, `class="box"`) != 1 {
		t.Fatalf("a frame under the threshold shows no box: %s", html)
	}
	// Boxes measured on another size are scaled to it, and kept inside the picture.
	body, _, err = render([]byte("```frames title=\"T\" size=\"400x240\" threshold=\"0.9\"\n../images/a.jpg | t | 0.95 | -2,24,200,250\n```\n"), fakeImages("800", "480", &seen))
	if err != nil || !strings.Contains(string(body), `left:0.0%;top:10.0%;width:50.0%;height:90.0%`) {
		t.Fatalf("%s: %v", body, err)
	}
	for _, bad := range []string{
		"```frames\n../images/a.jpg | t | 0.5\n```\n",
		"```frames title=\"T\"\n```\n",
		"```frames title=\"T\"\n../images/a.jpg | t\n```\n",
		"```frames title=\"T\"\n | t | 0.5\n```\n",
		"```frames title=\"T\"\n../images/a.jpg | t | 1.5\n```\n",
		"```frames title=\"T\"\n../images/a.jpg | t | 0.9 | 1,2,3\n```\n",
		"```frames title=\"T\"\n../images/a.jpg | t | 0.9 | 5,5,1,1\n```\n",
		"```frames title=\"T\" cols=\"9\"\n../images/a.jpg | t | 0.9\n```\n",
		"```frames title=\"T\" size=\"wide\"\n../images/a.jpg | t | 0.9\n```\n",
		"```frames title=\"T\" color=\"red\"\n../images/a.jpg | t | 0.9\n```\n",
	} {
		if _, _, err := render([]byte(bad), fakeImages("800", "480", &seen)); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
	if _, _, err := render([]byte("```frames title=\"T\"\n../images/a.svg | t | 0.9 | 1,1,2,2\n```\n"), fakeImages("", "", &seen)); err == nil {
		t.Fatal("a box on an image of unknown size needs size=")
	}
}
