package main

import (
	"fmt"
	"html"
	"strings"
)

// A ```trace fence is an excerpt of an agent's log with notes beside the
// lines that matter. Each entry is "kind | text"; only the first | splits,
// so shell pipes stay in the text. Lines indented by two spaces continue
// the entry above, "note | …" annotates it, and "fold | summary" … "end"
// collapses a run of entries behind a summary. Long entries collapse to
// their first lines by themselves. <details> does the folding, so it all
// works without scripts.
//
//	```trace title="…"
//	user | Which option …
//	cmd | ffmpeg -i video.mp4 -vf fps=1 f/%04d.jpg | tail
//	fold | 12 more tool calls
//	out | …
//	end
//	ans | {"answer_letter": "A"}
//	note | The answer is already here.
//	error | technical_error
var (
	traceAttributes = []string{"title", "note"}
	// traceKinds are the entry kinds and the label each shows.
	traceKinds = map[string]string{"user": "user", "cmd": "$", "out": "out", "tool": "tool", "say": "agent", "ans": "answer", "error": "error"}
)

// An entry longer than this many lines shows its first traceShown lines and folds the rest.
const (
	traceLong  = 6
	traceShown = 3
)

type traceEntry struct {
	kind, text, note string
	fold             []*traceEntry // the entries of a fold
}

func parseTrace(lines []string) ([]*traceEntry, error) {
	var top []*traceEntry
	var fold *traceEntry // the open fold, if any
	var last *traceEntry
	for _, raw := range lines {
		raw = strings.TrimRight(raw, "\r\n")
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if strings.HasPrefix(raw, "  ") {
			if last == nil || last.fold != nil {
				return nil, fmt.Errorf("%q: an indented line continues the entry above it", raw)
			}
			last.text += "\n" + raw[2:]
			continue
		}
		line := strings.TrimSpace(raw)
		if line == "end" {
			if fold == nil {
				return nil, fmt.Errorf("end without a fold")
			}
			fold, last = nil, nil
			continue
		}
		kind, text, ok := strings.Cut(line, "|")
		kind, text = strings.TrimSpace(kind), strings.TrimSpace(text)
		switch {
		case !ok:
			return nil, fmt.Errorf("%q: write kind | text with kind one of user, cmd, out, tool, say, ans, error, note, fold", line)
		case kind == "note":
			if last == nil || last.fold != nil || last.note != "" {
				return nil, fmt.Errorf("%q: a note follows the one entry it annotates", line)
			}
			last.note = text
			continue
		case kind == "fold":
			if fold != nil {
				return nil, fmt.Errorf("%q: folds do not nest; close the open one with end", line)
			}
			fold = &traceEntry{kind: "fold", text: text, fold: []*traceEntry{}}
			top = append(top, fold)
			last = fold
			continue
		case traceKinds[kind] == "":
			return nil, fmt.Errorf("%q: unknown kind %q (use user, cmd, out, tool, say, ans, error, note, fold)", line, kind)
		}
		last = &traceEntry{kind: kind, text: text}
		if fold != nil {
			fold.fold = append(fold.fold, last)
		} else {
			top = append(top, last)
		}
	}
	if fold != nil {
		return nil, fmt.Errorf("fold %q has no end", fold.text)
	}
	if len(top) == 0 {
		return nil, fmt.Errorf("no kind | text lines")
	}
	return top, nil
}

func writeTrace(b *strings.Builder, entries []*traceEntry) {
	b.WriteString(`<ol class="trace-log">`)
	for _, e := range entries {
		if e.fold != nil {
			if len(e.fold) == 0 {
				continue
			}
			fmt.Fprintf(b, `<li class="t-fold"><details><summary>%s</summary>`, html.EscapeString(e.text))
			writeTrace(b, e.fold)
			b.WriteString("</details></li>")
			continue
		}
		fmt.Fprintf(b, `<li class="t-%s"><span class="t-k">%s</span>`, e.kind, traceKinds[e.kind])
		if lines := strings.Split(e.text, "\n"); len(lines) > traceLong {
			fmt.Fprintf(b, `<details class="t-x"><summary><span>%s</span> <i>⋯ +%d</i></summary><span>%s</span></details>`,
				html.EscapeString(strings.Join(lines[:traceShown], "\n")), len(lines)-traceShown, html.EscapeString(strings.Join(lines[traceShown:], "\n")))
		} else {
			fmt.Fprintf(b, `<span class="t-x">%s</span>`, html.EscapeString(e.text))
		}
		if e.note != "" {
			fmt.Fprintf(b, `<span class="t-note">%s</span>`, html.EscapeString(e.note))
		}
		b.WriteString("</li>")
	}
	b.WriteString("</ol>")
}

func renderTrace(info string, lines []string) (string, error) {
	attrs, err := blockAttributes(info, traceAttributes)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(attrs["title"]) == "" {
		return "", fmt.Errorf("needs a title")
	}
	entries, err := parseTrace(lines)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, `<figure class="trace"><figcaption>%s</figcaption>`, html.EscapeString(attrs["title"]))
	writeTrace(&b, entries)
	if attrs["note"] != "" {
		fmt.Fprintf(&b, `<p class="figure-note">%s</p>`, html.EscapeString(attrs["note"]))
	}
	b.WriteString("</figure>\n")
	return b.String(), nil
}
