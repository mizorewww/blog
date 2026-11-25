package main

import (
	"bytes"
	"fmt"
	"html"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// Anki review cards follow the anki-card-authoring v1.0.0 Markdown contract:
// a single "# Cards" heading whose cards are separated by "---" lines.
// On the blog, the section becomes a collapsed <details class="cards-deck">
// at the foot of the article, with interactive Cloze blanks and Basic answers.

type ankiCard struct {
	Kind  string
	UUID  string
	Path  string
	Tags  []string
	Text  string
	Extra string
	Front string
	Back  string
}

type scannedLine struct {
	text      string
	start     int
	end       int
	protected bool
}

type cardsSection struct {
	startOffset        int
	contentStartOffset int
	endOffset          int
}

var (
	cardsHeadingRe = regexp.MustCompile(`^(#{1,6})[ \t]+(.+?)\s*$`)
	cardsMetaRe    = regexp.MustCompile(`(?i)^\s*(type|tags?|uuid|path)\s*:\s*(.*?)\s*$`)
	cardsMarkerRe  = regexp.MustCompile(`(?i)^\s*(Front|Back|Extra)\s*$`)
	cardsUUIDRe    = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	cardsHasCloze  = regexp.MustCompile(`(?i)\{\{c\d+::`)
	cardsBadTickRe = regexp.MustCompile("(?i)`\\{\\{c\\d+::|\\}\\}``?")
	cardsHeadingID = regexp.MustCompile(`<h([1-6]) id="[^"]*">(.*?)</h[1-6]>`)
)

func scanMarkdownLines(src string) []scannedLine {
	raw := strings.Split(src, "\n")
	lines := make([]scannedLine, 0, len(raw))
	offset := 0
	fence := ""
	for i, line := range raw {
		trimmed := strings.TrimSpace(line)
		prot := fence != ""
		if fence == "" {
			if mark, rest := fencePrefix(trimmed); mark != "" && (mark[0] != '`' || !strings.ContainsRune(rest, '`')) {
				fence = mark
				prot = true
			}
		} else if mark, rest := fencePrefix(trimmed); rest == "" && len(mark) >= len(fence) && mark[0] == fence[0] {
			fence = ""
			prot = true
		}
		lines = append(lines, scannedLine{
			text:      line,
			start:     offset,
			end:       offset + len(line),
			protected: prot,
		})
		offset += len(line)
		if i < len(raw)-1 {
			offset++
		}
	}
	return lines
}

func findCardsSection(src string) (*cardsSection, error) {
	lines := scanMarkdownLines(src)
	type headingHit struct {
		idx   int
		level int
		line  scannedLine
	}
	var hits []headingHit
	for i, line := range lines {
		if line.protected {
			continue
		}
		m := cardsHeadingRe.FindStringSubmatch(line.text)
		if m == nil {
			continue
		}
		title := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(m[2]), "#"))
		if strings.EqualFold(title, "cards") {
			hits = append(hits, headingHit{idx: i, level: len(m[1]), line: line})
		}
	}
	if len(hits) == 0 {
		return nil, nil
	}
	if len(hits) > 1 {
		return nil, fmt.Errorf(`multiple "# Cards" headings are not allowed`)
	}
	hit := hits[0]
	endIdx := len(lines)
	for i := hit.idx + 1; i < len(lines); i++ {
		if lines[i].protected {
			continue
		}
		if m := cardsHeadingRe.FindStringSubmatch(lines[i].text); m != nil && len(m[1]) <= hit.level {
			endIdx = i
			break
		}
	}
	contentStart := len(src)
	if hit.line.end < len(src) {
		contentStart = hit.line.end + 1
	}
	endOffset := len(src)
	if endIdx < len(lines) {
		endOffset = lines[endIdx].start
	}
	return &cardsSection{
		startOffset:        hit.line.start,
		contentStartOffset: contentStart,
		endOffset:          endOffset,
	}, nil
}

// stripCardsSection drops the optional "# Cards" section before counting reading units.
func stripCardsSection(src string) string {
	sec, err := findCardsSection(src)
	if err != nil || sec == nil {
		return src
	}
	return src[:sec.startOffset] + src[sec.endOffset:]
}

func normalizeCardKind(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "cloze":
		return "cloze", nil
	case "cloze-type", "cloze-typing":
		return "cloze-typing", nil
	case "basic":
		return "basic", nil
	case "reversed", "basic-reversed":
		return "basic-reversed", nil
	case "basic-type", "basic-typing":
		return "basic-typing", nil
	default:
		return "", fmt.Errorf("unsupported card type %q", raw)
	}
}

func hasDataviewInlineConflict(line string) bool {
	if !strings.Contains(line, "::") {
		return false
	}
	var stack []byte
	inTick := false
	for i := 0; i < len(line); i++ {
		ch := line[i]
		if ch == '`' {
			inTick = !inTick
			continue
		}
		if inTick {
			continue
		}
		switch ch {
		case '(', '[':
			stack = append(stack, ch)
		case ')':
			if len(stack) > 0 && stack[len(stack)-1] == '(' {
				stack = stack[:len(stack)-1]
			}
		case ']':
			if len(stack) > 0 && stack[len(stack)-1] == '[' {
				stack = stack[:len(stack)-1]
			}
		case ':':
			if i+1 < len(line) && line[i+1] == ':' && len(stack) > 0 {
				return true
			}
		}
	}
	return false
}

func validateCardSafety(field string) error {
	for _, line := range scanMarkdownLines(field) {
		if line.protected {
			continue
		}
		if hasDataviewInlineConflict(line.text) {
			return fmt.Errorf("Dataview inline-field conflict on %q: avoid '::' inside (...) or [...]", line.text)
		}
		if cardsBadTickRe.MatchString(line.text) {
			return fmt.Errorf("do not wrap inline code backticks directly around a cloze deletion: %q", line.text)
		}
		s := line.text
		for i := 0; i < len(s); {
			if s[i] != '`' {
				i++
				continue
			}
			j := i
			for j < len(s) && s[j] == '`' {
				j++
			}
			ticks := s[i:j]
			closeRel := strings.Index(s[j:], ticks)
			if closeRel < 0 {
				break
			}
			inner := strings.TrimSpace(s[j : j+closeRel])
			if cardsHasCloze.MatchString(inner) {
				return fmt.Errorf("do not wrap a cloze deletion inside inline code backticks: %q", line.text)
			}
			if strings.HasPrefix(inner, "=") || strings.HasPrefix(inner, "$=") {
				return fmt.Errorf("inline code span must not start with '=' or '$=': %q", line.text)
			}
			i = j + closeRel + len(ticks)
		}
	}
	return nil
}

type clozeSpan struct {
	start, end int
	num        int
	answer     string
	hint       string
}

func parseClozeSpans(src string) ([]clozeSpan, error) {
	var spans []clozeSpan
	lines := scanMarkdownLines(src)
	for _, line := range lines {
		if line.protected {
			continue
		}
		if err := collectLineClozes(line.text, line.start, &spans); err != nil {
			return nil, err
		}
	}
	// Multi-line clozes (e.g. inside $$...$$ display math) can span non-fenced lines;
	// scan unprotected chunks when line-by-line missed a cross-line cloze.
	if len(spans) == 0 && cardsHasCloze.MatchString(src) {
		if err := collectChunkClozes(lines, src, &spans); err != nil {
			return nil, err
		}
	}
	return spans, nil
}

func collectChunkClozes(lines []scannedLine, src string, spans *[]clozeSpan) error {
	chunkStart := -1
	for i, l := range lines {
		if !l.protected && chunkStart < 0 {
			chunkStart = l.start
		}
		if (l.protected || i == len(lines)-1) && chunkStart >= 0 {
			chunkEnd := l.start
			if !l.protected {
				chunkEnd = l.end
			}
			if err := collectLineClozes(src[chunkStart:chunkEnd], chunkStart, spans); err != nil {
				return err
			}
			chunkStart = -1
		}
	}
	return nil
}

func collectLineClozes(s string, baseOffset int, out *[]clozeSpan) error {
	for i := 0; i < len(s); {
		rel := strings.Index(strings.ToLower(s[i:]), "{{c")
		if rel < 0 {
			return nil
		}
		start := i + rel
		j := start + 3
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			j++
		}
		if j == start+3 || j+1 >= len(s) || s[j] != ':' || s[j+1] != ':' {
			i = start + 2
			continue
		}
		num, err := strconv.Atoi(s[start+3 : j])
		if err != nil || num < 1 {
			return fmt.Errorf("invalid cloze index in %q", s[start:min(len(s), j+4)])
		}
		bodyStart := j + 2
		depth := 0
		end := -1
		hintSep := -1
		for k := bodyStart; k < len(s); k++ {
			if k+1 < len(s) && s[k] == '{' && s[k+1] == '{' && cardsHasCloze.MatchString(s[k:]) {
				return fmt.Errorf("nested cloze deletions are not allowed")
			}
			if s[k] == '{' {
				depth++
			} else if s[k] == '}' {
				if depth == 0 && k+1 < len(s) && s[k+1] == '}' {
					// If immediately followed by more closing braces (e.g. \mathrm{RMS}}} in LaTeX),
					// the inner } belongs to TeX and the final }} closes the cloze.
					for k+2 < len(s) && s[k+2] == '}' {
						k++
					}
					end = k
					break
				}
				if depth > 0 {
					depth--
				}
			} else if depth == 0 && hintSep < 0 && k+1 < len(s) && s[k] == ':' && s[k+1] == ':' {
				hintSep = k
			}
		}
		if end < 0 {
			return fmt.Errorf("unclosed cloze deletion starting at %q", s[start:min(len(s), start+24)])
		}
		ans := s[bodyStart:end]
		hint := ""
		if hintSep >= 0 {
			ans = s[bodyStart:hintSep]
			hint = strings.TrimSpace(s[hintSep+2 : end])
		}
		if strings.TrimSpace(ans) == "" {
			return fmt.Errorf("empty cloze answer")
		}
		*out = append(*out, clozeSpan{
			start:  baseOffset + start,
			end:    baseOffset + end + 2,
			num:    num,
			answer: ans,
			hint:   hint,
		})
		i = end + 2
	}
	return nil
}

func parseCardsSection(body string) ([]ankiCard, error) {
	lines := scanMarkdownLines(body)
	var blocks []string
	var cur []string
	for _, line := range lines {
		if !line.protected && strings.TrimSpace(line.text) == "---" {
			blocks = append(blocks, strings.Join(cur, "\n"))
			cur = nil
			continue
		}
		cur = append(cur, line.text)
	}
	blocks = append(blocks, strings.Join(cur, "\n"))

	var cards []ankiCard
	seenUUIDs := map[string]bool{}
	for _, raw := range blocks {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		card, err := parseOneCardBlock(raw)
		if err != nil {
			return nil, err
		}
		if card.UUID != "" {
			if seenUUIDs[card.UUID] {
				return nil, fmt.Errorf("duplicate card uuid %s", card.UUID)
			}
			seenUUIDs[card.UUID] = true
		}
		cards = append(cards, card)
	}
	return cards, nil
}

func parseOneCardBlock(block string) (ankiCard, error) {
	meta := map[string]string{}
	var tags []string
	var content []string
	type marker struct {
		name string
		idx  int
	}
	var markers []marker

	for _, line := range scanMarkdownLines(block) {
		if !line.protected {
			if m := cardsMetaRe.FindStringSubmatch(line.text); m != nil {
				key := strings.ToLower(m[1])
				val := strings.TrimSpace(m[2])
				if key == "tag" || key == "tags" {
					val = strings.TrimPrefix(strings.TrimSuffix(val, "]"), "[")
					for _, f := range strings.FieldsFunc(val, func(r rune) bool {
						return r == ',' || r == ' ' || r == '\t'
					}) {
						f = strings.Trim(f, `"'#`)
						if f != "" && !slices.Contains(tags, f) {
							tags = append(tags, f)
						}
					}
				} else {
					if _, dup := meta[key]; dup {
						return ankiCard{}, fmt.Errorf("duplicate %s metadata in card", key)
					}
					meta[key] = val
				}
				continue
			}
			if m := cardsMarkerRe.FindStringSubmatch(line.text); m != nil {
				markers = append(markers, marker{name: strings.ToLower(m[1]), idx: len(content)})
			}
		}
		content = append(content, line.text)
	}

	joined := strings.TrimSpace(strings.Join(content, "\n"))
	kind := "basic"
	if cardsHasCloze.MatchString(joined) {
		kind = "cloze"
	}
	if rawType, ok := meta["type"]; ok {
		var err error
		if kind, err = normalizeCardKind(rawType); err != nil {
			return ankiCard{}, err
		}
	}
	uuid := strings.ToLower(meta["uuid"])
	if uuid != "" && !cardsUUIDRe.MatchString(uuid) {
		return ankiCard{}, fmt.Errorf("invalid card uuid %q", meta["uuid"])
	}

	card := ankiCard{
		Kind: kind,
		UUID: uuid,
		Path: meta["path"],
		Tags: tags,
	}
	if strings.HasPrefix(kind, "cloze") {
		var extraIdx = -1
		for _, m := range markers {
			if m.name != "extra" || extraIdx >= 0 {
				return ankiCard{}, fmt.Errorf("cloze card cannot contain Front/Back or multiple Extra markers")
			}
			extraIdx = m.idx
		}
		if extraIdx >= 0 {
			card.Text = strings.TrimSpace(strings.Join(content[:extraIdx], "\n"))
			card.Extra = strings.TrimSpace(strings.Join(content[extraIdx+1:], "\n"))
		} else {
			card.Text = joined
		}
		spans, err := parseClozeSpans(card.Text)
		if err != nil {
			return ankiCard{}, err
		}
		if len(spans) == 0 {
			return ankiCard{}, fmt.Errorf("cloze card requires at least one {{cN::...}} deletion")
		}
		if err := validateCardSafety(card.Text); err != nil {
			return ankiCard{}, err
		}
		if err := validateCardSafety(card.Extra); err != nil {
			return ankiCard{}, err
		}
	} else {
		var fronts, backs []int
		for _, m := range markers {
			switch m.name {
			case "front":
				fronts = append(fronts, m.idx)
			case "back":
				backs = append(backs, m.idx)
			default:
				return ankiCard{}, fmt.Errorf("basic card cannot contain Extra marker")
			}
		}
		if len(fronts) != 1 || len(backs) != 1 || fronts[0] >= backs[0] {
			return ankiCard{}, fmt.Errorf("basic card requires one Front followed by one Back marker")
		}
		frontLines := append([]string{}, content[:fronts[0]]...)
		frontLines = append(frontLines, content[fronts[0]+1:backs[0]]...)
		card.Front = strings.TrimSpace(strings.Join(frontLines, "\n"))
		card.Back = strings.TrimSpace(strings.Join(content[backs[0]+1:], "\n"))
		if card.Front == "" || card.Back == "" {
			return ankiCard{}, fmt.Errorf("basic card requires non-empty Front and Back")
		}
		if cardsHasCloze.MatchString(card.Front + "\n" + card.Back) {
			return ankiCard{}, fmt.Errorf("basic card must not contain cloze syntax")
		}
		if err := validateCardSafety(card.Front); err != nil {
			return ankiCard{}, err
		}
		if err := validateCardSafety(card.Back); err != nil {
			return ankiCard{}, err
		}
	}
	return card, nil
}

// extractCardTitle pulls an optional leading "## Title" line out of a card's prompt.
func extractCardTitle(markdownText string) (title, rest string) {
	lines := strings.Split(strings.TrimSpace(markdownText), "\n")
	if len(lines) == 0 {
		return "", ""
	}
	first := strings.TrimSpace(lines[0])
	if strings.HasPrefix(first, "## ") {
		return strings.TrimSpace(first[3:]), strings.TrimSpace(strings.Join(lines[1:], "\n"))
	}
	return "", strings.TrimSpace(markdownText)
}

func renderCardMarkdown(md goldmark.Markdown, src string, hooks contentHooks) (string, error) {
	if strings.TrimSpace(src) == "" {
		return "", nil
	}
	b := []byte(src + "\n")
	ctx := parser.NewContext(parser.WithIDs(headingIDs{}))
	doc := md.Parser().Parse(text.NewReader(b), parser.WithContext(ctx))
	err := ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if node, ok := n.(*ast.Image); entering && ok && hooks.image != nil {
			if err := hooks.image(node); err != nil {
				return ast.WalkStop, err
			}
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := md.Renderer().Render(&out, b, doc); err != nil {
		return "", err
	}
	rendered := strings.ReplaceAll(out.String(), "<pre>", `<pre tabindex="0">`)
	// Keep headings inside flashcards out of TOC / withAnchors.
	rendered = cardsHeadingID.ReplaceAllString(rendered, `<p class="anki-sub">$2</p>`)
	return strings.TrimSpace(rendered), nil
}

func renderCardInline(md goldmark.Markdown, src string, hooks contentHooks) (string, error) {
	rendered, err := renderCardMarkdown(md, strings.TrimSpace(src), hooks)
	if err != nil {
		return "", err
	}
	if strings.HasPrefix(rendered, "<p>") && strings.HasSuffix(rendered, "</p>") && strings.Count(rendered, "<p>") == 1 {
		return rendered[3 : len(rendered)-4], nil
	}
	return rendered, nil
}

type clozeReplacement struct {
	token string
	html  string
}

func renderClozeField(md goldmark.Markdown, src string, hooks contentHooks) (string, error) {
	var reps []clozeReplacement
	nextToken := func(block bool) string {
		if block {
			return fmt.Sprintf("ANKICLOZEBLOCK%04dEND", len(reps))
		}
		return fmt.Sprintf("ANKICLOZEINLINE%04dEND", len(reps))
	}

	// Step 1: handle display math blocks ($$...$$) containing {{cN::...}} outside code fences.
	lines := scanMarkdownLines(src)
	var stage1 strings.Builder
	for i := 0; i < len(lines); i++ {
		if !lines[i].protected && strings.TrimSpace(lines[i].text) == "$$" {
			closeIdx := -1
			for j := i + 1; j < len(lines); j++ {
				if !lines[j].protected && strings.TrimSpace(lines[j].text) == "$$" {
					closeIdx = j
					break
				}
			}
			if closeIdx > i {
				var texLines []string
				for k := i + 1; k < closeIdx; k++ {
					texLines = append(texLines, lines[k].text)
				}
				tex := strings.Join(texLines, "\n")
				if cardsHasCloze.MatchString(tex) {
					btnHTML, err := buildMathClozeHTML(tex, true)
					if err != nil {
						return "", err
					}
					tok := nextToken(true)
					reps = append(reps, clozeReplacement{token: tok, html: btnHTML})
					stage1.WriteString(tok)
					if closeIdx < len(lines)-1 {
						stage1.WriteByte('\n')
					}
					i = closeIdx
					continue
				}
			}
		}
		stage1.WriteString(lines[i].text)
		if i < len(lines)-1 {
			stage1.WriteByte('\n')
		}
	}

	// Step 2: handle inline $...$ math containing {{cN::...}} and prose {{cN::...}} outside code fences.
	lines2 := scanMarkdownLines(stage1.String())
	var stage2 strings.Builder
	for i, line := range lines2 {
		if line.protected {
			stage2.WriteString(line.text)
		} else {
			transformed, err := replaceLineClozes(md, line.text, hooks, &reps, nextToken)
			if err != nil {
				return "", err
			}
			stage2.WriteString(transformed)
		}
		if i < len(lines2)-1 {
			stage2.WriteByte('\n')
		}
	}

	rendered, err := renderCardMarkdown(md, stage2.String(), hooks)
	if err != nil {
		return "", err
	}
	for _, rep := range reps {
		if strings.HasPrefix(rep.token, "ANKICLOZEBLOCK") {
			rendered = strings.ReplaceAll(rendered, "<p>"+rep.token+"</p>", rep.html)
		}
		rendered = strings.ReplaceAll(rendered, rep.token, rep.html)
	}
	return rendered, nil
}

func replaceLineClozes(md goldmark.Markdown, line string, hooks contentHooks, reps *[]clozeReplacement, nextToken func(bool) string) (string, error) {
	// First replace inline $...$ spans whose TeX contains {{cN::...}}.
	var mathPass strings.Builder
	for i := 0; i < len(line); {
		if line[i] == '`' {
			j := i
			for j < len(line) && line[j] == '`' {
				j++
			}
			ticks := line[i:j]
			if closeRel := strings.Index(line[j:], ticks); closeRel >= 0 {
				mathPass.WriteString(line[i : j+closeRel+len(ticks)])
				i = j + closeRel + len(ticks)
				continue
			}
		}
		if line[i] == '\\' && i+1 < len(line) && line[i+1] == '$' {
			mathPass.WriteString(`\$`)
			i += 2
			continue
		}
		if line[i] == '$' {
			fence := 1
			if i+1 < len(line) && line[i+1] == '$' {
				fence = 2
			}
			body := line[i+fence:]
			if len(body) > 0 && body[0] != ' ' && body[0] != '\t' && body[0] != '$' {
				end := -1
				for k := 0; k < len(body); k++ {
					switch {
					case body[k] == '\\':
						k++
					case body[k] == '`':
						k = len(body)
					case k == 0 || body[k] != '$' || body[k-1] == ' ' || body[k-1] == '\t':
					case fence == 2 && (k+1 >= len(body) || body[k+1] != '$'):
					case fence == 1 && k+1 < len(body) && body[k+1] >= '0' && body[k+1] <= '9':
					default:
						end = k
					}
					if end >= 0 {
						break
					}
				}
				if end >= 0 {
					tex := body[:end]
					if cardsHasCloze.MatchString(tex) {
						btnHTML, err := buildMathClozeHTML(tex, false)
						if err != nil {
							return "", err
						}
						tok := nextToken(false)
						*reps = append(*reps, clozeReplacement{token: tok, html: btnHTML})
						mathPass.WriteString(tok)
						i += fence + end + fence
						continue
					}
					mathPass.WriteString(line[i : i+fence+end+fence])
					i += fence + end + fence
					continue
				}
			}
		}
		mathPass.WriteByte(line[i])
		i++
	}

	s := mathPass.String()
	var spans []clozeSpan
	if err := collectLineClozes(s, 0, &spans); err != nil {
		return "", err
	}
	if len(spans) == 0 {
		return s, nil
	}
	var out strings.Builder
	pos := 0
	for _, sp := range spans {
		out.WriteString(s[pos:sp.start])
		ansHTML, err := renderCardInline(md, sp.answer, hooks)
		if err != nil {
			return "", err
		}
		mask := fmt.Sprintf("[c%d]", sp.num)
		if sp.hint != "" {
			mask = fmt.Sprintf("[c%d · %s]", sp.num, sp.hint)
		}
		btn := fmt.Sprintf(`<button type="button" class="cloze" data-c="%d" aria-expanded="false"><span class="cloze-mask">%s</span><span class="cloze-ans">%s</span></button>`,
			sp.num, html.EscapeString(mask), ansHTML)
		tok := nextToken(false)
		*reps = append(*reps, clozeReplacement{token: tok, html: btn})
		out.WriteString(tok)
		pos = sp.end
	}
	out.WriteString(s[pos:])
	return out.String(), nil
}

func buildMathClozeHTML(tex string, display bool) (string, error) {
	var spans []clozeSpan
	if err := collectLineClozes(tex, 0, &spans); err != nil {
		return "", err
	}
	if len(spans) == 0 {
		return "", fmt.Errorf("expected cloze in math %q", tex)
	}
	var maskedTeX, answerTeX strings.Builder
	var nums []string
	pos := 0
	for _, sp := range spans {
		maskedTeX.WriteString(tex[pos:sp.start])
		answerTeX.WriteString(tex[pos:sp.start])
		label := fmt.Sprintf("[c%d]", sp.num)
		if sp.hint != "" {
			label = fmt.Sprintf("[c%d: %s]", sp.num, sp.hint)
		}
		maskedTeX.WriteString(`\text{` + label + `}`)
		answerTeX.WriteString(`{` + sp.answer + `}`)
		nStr := strconv.Itoa(sp.num)
		if !slices.Contains(nums, nStr) {
			nums = append(nums, nStr)
		}
		pos = sp.end
	}
	maskedTeX.WriteString(tex[pos:])
	answerTeX.WriteString(tex[pos:])

	maskedSVG, err := mathString(maskedTeX.String(), display)
	if err != nil {
		return "", err
	}
	answerSVG, err := mathString(answerTeX.String(), display)
	if err != nil {
		return "", err
	}
	dataC := strings.Join(nums, ",")
	if display {
		return fmt.Sprintf(`<div class="cloze-block"><button type="button" class="cloze cloze-math" data-c="%s" aria-expanded="false"><span class="cloze-mask"><span class="math">%s</span></span><span class="cloze-ans"><span class="math">%s</span></span></button></div>`,
			dataC, maskedSVG, answerSVG), nil
	}
	return fmt.Sprintf(`<button type="button" class="cloze cloze-math" data-c="%s" aria-expanded="false"><span class="cloze-mask"><span class="math-inline">%s</span></span><span class="cloze-ans"><span class="math-inline">%s</span></span></button>`,
		dataC, maskedSVG, answerSVG), nil
}

func cardTypeBadge(kind string) string {
	switch kind {
	case "cloze", "cloze-typing":
		return "CLOZE"
	case "basic-reversed":
		return "REVERSED"
	default:
		return "BASIC"
	}
}

func renderCardsDeck(sectionBody string, md goldmark.Markdown, ui UI, hooks contentHooks) (string, error) {
	cards, err := parseCardsSection(sectionBody)
	if err != nil {
		return "", err
	}
	if len(cards) == 0 {
		return "", nil
	}
	var b strings.Builder
	metaText := fmt.Sprintf(ui.CardsMeta, len(cards))
	fmt.Fprintf(&b, `<details class="cards-deck" id="cards"><summary class="cards-summary"><span class="cards-head"><span class="eyebrow">ANKI</span><span class="cards-title">%s</span></span><span class="cards-meta"><span class="key">%s</span><i class="cards-caret" aria-hidden="true"></i></span></summary>`,
		html.EscapeString(ui.CardsTitle), html.EscapeString(metaText))
	fmt.Fprintf(&b, `<div class="cards-body"><div class="cards-tools"><button type="button" class="textbtn" data-cards-act="reveal">%s</button><button type="button" class="textbtn" data-cards-act="hide">%s</button></div><div class="cards-list">`,
		html.EscapeString(ui.CardsRevealAll), html.EscapeString(ui.CardsHideAll))

	for i, card := range cards {
		fmt.Fprintf(&b, `<article class="anki-card">`)
		var titleRaw, bodyRaw string
		if strings.HasPrefix(card.Kind, "cloze") {
			titleRaw, bodyRaw = extractCardTitle(card.Text)
		} else {
			titleRaw, bodyRaw = extractCardTitle(card.Front)
		}
		fmt.Fprintf(&b, `<div class="anki-head"><span class="key">%02d · %s</span>`, i+1, cardTypeBadge(card.Kind))
		if titleRaw != "" {
			titleHTML, err := renderCardInline(md, titleRaw, hooks)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&b, `<p class="anki-title">%s</p>`, titleHTML)
		}
		b.WriteString(`</div>`)

		if strings.HasPrefix(card.Kind, "cloze") {
			frontHTML, err := renderClozeField(md, bodyRaw, hooks)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&b, `<div class="anki-front">%s</div>`, frontHTML)
			if card.Extra != "" {
				extraHTML, err := renderCardMarkdown(md, card.Extra, hooks)
				if err != nil {
					return "", err
				}
				fmt.Fprintf(&b, `<div class="anki-extra"><p class="anki-label"><span class="key">%s</span></p>%s</div>`,
					html.EscapeString(ui.CardExtra), extraHTML)
			}
		} else {
			frontHTML, err := renderCardMarkdown(md, bodyRaw, hooks)
			if err != nil {
				return "", err
			}
			backHTML, err := renderCardMarkdown(md, card.Back, hooks)
			if err != nil {
				return "", err
			}
			fmt.Fprintf(&b, `<div class="anki-front">%s</div>`, frontHTML)
			fmt.Fprintf(&b, `<details class="anki-back"><summary><span class="key">%s</span></summary><div class="anki-back-body">%s</div></details>`,
				html.EscapeString(ui.CardShowBack), backHTML)
		}

		if len(card.Tags) > 0 {
			b.WriteString(`<p class="tags anki-tags">`)
			for _, t := range card.Tags {
				fmt.Fprintf(&b, `<span>#%s</span>`, html.EscapeString(t))
			}
			b.WriteString(`</p>`)
		}
		b.WriteString(`</article>`)
	}

	b.WriteString("</div></div></details><!--/cards-deck-->\n")
	return b.String(), nil
}
