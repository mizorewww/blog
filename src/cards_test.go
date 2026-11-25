package main

import (
	"strings"
	"testing"
)

func TestCardsDeckRenderAndIsolation(t *testing.T) {
	src := `## 正文小节

这里是一段正文，讨论 $x^2$。

# Cards

type: cloze
tags: ML/Optimizer, LLM
uuid: 11111111-2222-4333-8444-555555555555

## RMSNorm 径向正交与 $1/r(x)$ 阻尼

前向满足正标量 **{{c1::尺度不变性}}**，反向梯度满足 **{{c2::$x^\top \nabla_x L = 0$::正交条件}}**。

$$
\Delta W^* = {{c3::-\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} U V^\top}}
$$

Extra
因此缩放向量 $\gamma$ 通常设 ` + "`weight_decay = 0.0`" + `。

---

type: basic
tags: ML/Optimizer
uuid: 66666666-7777-4888-8999-aaaaaaaaaaaa

## 耦合 L2 与解耦权重衰减

Front
为什么 ` + "`Adam + L2`" + ` 不等价于等比例权重衰减？

` + "```python\ng = grad + wd * param\n```" + `

Back
因为预条件算子 $\sqrt{\hat{v}_t}$ 会把衰减项一并缩放，大梯度坐标的正则化反而变弱。
`

	got, toc, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{})
	if err != nil {
		t.Fatalf("renderContent failed: %v", err)
	}
	html := string(got)
	if len(toc) != 1 || toc[0].Title != "正文小节" {
		t.Fatalf("unexpected TOC (card headings leaked): %+v", toc)
	}
	for _, want := range []string{
		`<details class="cards-deck" id="cards">`,
		`Anki 复习卡片`,
		`2 张卡片 · 点击展开自测`,
		`data-c="1"`,
		`[c2 · 正交条件]`,
		`class="cloze cloze-math" data-c="3"`,
		`<div class="anki-extra">`,
		`<details class="anki-back">`,
		`<span>#ML/Optimizer</span>`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("rendered HTML missing %q\ngot:\n%s", want, html)
		}
	}

	// English edition localizes deck UI strings.
	enGot, _, err := renderContent(languages[1].markdown(), []byte(src), contentHooks{})
	if err != nil {
		t.Fatalf("en renderContent failed: %v", err)
	}
	if !strings.Contains(string(enGot), "Anki Review Cards") || !strings.Contains(string(enGot), "2 cards · click to review") {
		t.Errorf("English localization missing in deck:\n%s", enGot)
	}

	// Reading units exclude # Cards, and RSS feed strips the collapsed deck.
	withCards := readingUnits(src)
	withoutCards := readingUnits("## 正文小节\n\n这里是一段正文，讨论 $x^2$。\n")
	if withCards != withoutCards {
		t.Errorf("readingUnits included # Cards: got %d, want %d", withCards, withoutCards)
	}
	feed := feedContent(html, "https://example.com", "https://example.com/posts/x/", languages[0].UI)
	if strings.Contains(feed, "cards-deck") || strings.Contains(feed, "cloze-mask") {
		t.Errorf("feedContent leaked cards deck:\n%s", feed)
	}
}

func TestCardsValidationErrors(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"duplicate heading", "# Cards\n\n{{c1::a}}\n\n# Cards\n\n{{c1::b}}\n"},
		{"dataview parens", "# Cards\n\nBad ({{c1::inline}}) parens.\n"},
		{"backtick cloze", "# Cards\n\nBad `{{c1::code}}` span.\n"},
		{"basic missing back", "# Cards\n\ntype: basic\n\nFront\nOnly question\n"},
		{"duplicate uuid", "# Cards\n\nuuid: 11111111-2222-4333-8444-555555555555\n\n{{c1::a}}\n\n---\n\nuuid: 11111111-2222-4333-8444-555555555555\n\n{{c1::b}}\n"},
	}
	for _, tc := range cases {
		if _, _, err := renderContent(languages[0].markdown(), []byte(tc.body), contentHooks{}); err == nil {
			t.Errorf("%s: expected error, got nil", tc.name)
		}
	}
}
