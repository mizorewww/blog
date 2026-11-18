package main

import (
	"strings"
	"testing"
)

func TestTrace(t *testing.T) {
	src := "```trace title=\"答案已经写好了\" note=\"注\"\n" +
		"user | Which <option>?\n" +
		"cmd | ffmpeg -i v.mp4 -vf fps=1 f/%04d.jpg | tail -n 2\n" +
		"fold | 3 more calls\nout | a\nout | b\nend\n" +
		"out | 1\n  2\n  3\n  4\n  5\n  6\n  7\n" +
		"ans | {\"answer_letter\": \"A\"}\nnote | 答案在这里\n" +
		"error | technical_error\n```\n"
	body, _, err := render([]byte(src), nil)
	if err != nil {
		t.Fatal(err)
	}
	html := string(body)
	for _, want := range []string{
		`<figure class="trace"><figcaption>答案已经写好了</figcaption><ol class="trace-log">`,
		`<li class="t-user"><span class="t-k">user</span><span class="t-x">Which &lt;option&gt;?</span></li>`,
		`<li class="t-cmd"><span class="t-k">$</span><span class="t-x">ffmpeg -i v.mp4 -vf fps=1 f/%04d.jpg | tail -n 2</span></li>`,
		`<li class="t-fold"><details><summary>3 more calls</summary><ol class="trace-log"><li class="t-out"><span class="t-k">out</span><span class="t-x">a</span></li>`,
		`<details class="t-x"><summary><span>1` + "\n2\n3" + `</span> <i>⋯ +4</i></summary><span>4` + "\n5\n6\n7" + `</span></details>`,
		`<li class="t-ans"><span class="t-k">answer</span><span class="t-x">{&#34;answer_letter&#34;: &#34;A&#34;}</span><span class="t-note">答案在这里</span></li>`,
		`<li class="t-error"><span class="t-k">error</span><span class="t-x">technical_error</span></li></ol><p class="figure-note">注</p></figure>`,
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("missing %s in %s", want, html)
		}
	}
	for _, bad := range []string{
		"```trace\nuser | a\n```\n",
		"```trace title=\"T\"\n```\n",
		"```trace title=\"T\"\nnote | before anything\n```\n",
		"```trace title=\"T\"\ncmd | a\nnote | x\nnote | y\n```\n",
		"```trace title=\"T\"\nbash | a\n```\n",
		"```trace title=\"T\"\njust text\n```\n",
		"```trace title=\"T\"\nfold | a\nout | b\n```\n",
		"```trace title=\"T\"\nfold | a\nfold | b\nend\n```\n",
		"```trace title=\"T\"\nout | a\nend\n```\n",
		"```trace title=\"T\"\n  indented first\n```\n",
	} {
		if _, _, err := render([]byte(bad), nil); err == nil {
			t.Fatalf("expected an error for %q", bad)
		}
	}
}
