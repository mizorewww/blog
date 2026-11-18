package main

import (
	"strings"
	"testing"
)

func TestCases(t *testing.T) {
	src := "```cases title=\"三道题\" note=\"注\"\n" +
		"## ALLVB_2121 电影 · 2 h\ntag: 看错了\nq: What colour is the <shirt>?\n" +
		"答案 | ok | (E) purple\nClaude Opus 5.5 | bad | (C) red\nGlance | note | P 0.97 at 7:00\n\n" +
		"## S-EMBER_7291\nimage: ../images/t.jpg\nq: How many times?\n答案 | ok | (D) 5\n```\n"
	var seen []string
	body, _, err := render([]byte(src), fakeImages("640", "360", &seen))
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	if len(seen) != 1 || seen[0] != "../images/t.jpg" {
		t.Fatalf("a case's image must go through the image pipeline: %v", seen)
	}
	for _, want := range []string{
		`<figure class="cases"><figcaption>三道题</figcaption><div class="case-list"><article class="case"><div class="case-body">`,
		`<p class="case-head"><span class="key">ALLVB_2121</span><span>电影 · 2 h</span><em class="case-tag">看错了</em></p>`,
		`<p class="case-q">What colour is the &lt;shirt&gt;?</p>`,
		`<div class="ok"><dt>答案</dt><dd><i>✓</i>(E) purple</dd></div>`,
		`<div class="bad"><dt>Claude Opus 5.5</dt><dd><i>✗</i>(C) red</dd></div>`,
		`<div class="note"><dt>Glance</dt><dd><i>·</i>P 0.97 at 7:00</dd></div>`,
		`<article class="case with-image"><div class="case-image"><img src="/img/t.jpg" alt="S-EMBER_7291" width="640" height="360"`,
		`sizes="112px">`,
		`<p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	for _, bad := range []string{
		"```cases\n## A\n答案 | ok | x\n```\n",
		"```cases title=\"T\"\n```\n",
		"```cases title=\"T\"\n答案 | ok | x\n```\n",
		"```cases title=\"T\"\n## A\nq: only a question\n```\n",
		"```cases title=\"T\"\n## A\n答案 | right | x\n```\n",
		"```cases title=\"T\"\n## A\n答案 | ok\n```\n",
		"```cases title=\"T\"\n## A\nimage: ../images/a.jpg\nimage: ../images/b.jpg\n答案 | ok | x\n```\n",
	} {
		if _, _, err := render([]byte(bad), fakeImages("640", "360", &seen)); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
}
