package main

import (
	"strings"
	"testing"
)

func TestCitations(t *testing.T) {
	src := "一项研究[@b]，另一项[@a]，再提[@b][@a]。不是引用：[@ x]、[@user](https://github.com/user) 和 [链接](https://example.com)。\n\n" +
		"## 参考资料\n\n### 甲\n\n- [@a] A. [Title A](https://doi.org/1).\n\n### 乙\n\n- [@b] B. _Journal_.\n- [@c] C, not cited.\n"
	got, _, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`研究<sup class="cite"><a id="cite-b-1" href="#ref-b">[2]</a></sup>`,
		`另一项<sup class="cite"><a id="cite-a-1" href="#ref-a">[1]</a></sup>`,
		`<a id="cite-b-2" href="#ref-b">[2]</a></sup><sup class="cite"><a id="cite-a-2" href="#ref-a">[1]</a></sup>。`,
		`[@ x]`,
		`<a href="https://github.com/user">@user</a>`,
		`<ol class="references">` + "\n" + `<li id="ref-a"><span class="ref-back"><span aria-hidden="true">↑</span> <a href="#cite-a-1" aria-label="回到引用处 1">1</a> <a href="#cite-a-2" aria-label="回到引用处 2">2</a></span> A.`,
		`<ol start="2" class="references">` + "\n" + `<li id="ref-b"><span class="ref-back"><span aria-hidden="true">↑</span> <a href="#cite-b-1" aria-label="回到引用处 1">1</a> <a href="#cite-b-2" aria-label="回到引用处 2">2</a></span> B.`,
		`<li id="ref-c"> C, not cited.`,
	} {
		if !strings.Contains(string(got), want) {
			t.Errorf("missing %s in\n%s", want, got)
		}
	}
	for name, src := range map[string]string{
		"undefined":     "见[@nope]。\n",
		"duplicate":     "- [@a] A.\n- [@a] A again.\n",
		"mixed":         "- [@a] A.\n- just an item\n",
		"mixed-leading": "- just an item\n- [@a] A.\n",
	} {
		if _, _, err := renderContent(languages[0].markdown(), []byte(src), contentHooks{}); err == nil {
			t.Errorf("%s: must fail", name)
		}
	}
	if en, _, err := renderContent(languages[1].markdown(), []byte("See[@a].\n\n- [@a] A.\n"), contentHooks{}); err != nil || !strings.Contains(string(en), `<a href="#cite-a-1" aria-label="Back to citation">↑</a>`) {
		t.Errorf("English back link: %v\n%s", err, en)
	}
}
