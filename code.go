package main

import (
	"fmt"
	"html"
	"regexp"
	"strconv"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/util"
)

// Fenced code is highlighted at build time with classes styled in style.css.
// The fence names its language in a corner; src="<GitHub blob permalink>#L1-L9"
// turns it into a source quote with a path header and real line numbers:
//
//	```go src="https://github.com/o/r/blob/<sha>/main.go#L76-L103" title="…"
type codeExtension struct{}
type codeRenderer struct{}

var githubBlob = regexp.MustCompile(`^https://github\.com/[^/]+/[^/]+/blob/([0-9a-f]{7,40})/([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$`)

func (codeExtension) Extend(m goldmark.Markdown) {
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(codeRenderer{}, 100)))
}

// tokenClass is chroma's short class for a token, falling back to its
// sub-category and category; whitespace and plain text get none.
func tokenClass(t chroma.TokenType) string {
	for _, c := range []chroma.TokenType{t, t.SubCategory(), t.Category()} {
		if class := chroma.StandardTypes[c]; class != "" {
			if class == "w" || class == "err" {
				return ""
			}
			return class
		}
	}
	return ""
}

// highlight writes one span per token and nothing else, which keeps long
// listings small; first > 0 numbers the lines from there.
func highlight(w util.BufWriter, tokens []chroma.Token, first int) {
	w.WriteString(`<pre tabindex="0" class="chroma"><code>`)
	line := first
	number := func() {
		if first > 0 {
			fmt.Fprintf(w, `<span class="ln">%d</span>`, line)
			line++
		}
	}
	number()
	// The fence's final newline would number an empty line.
	for len(tokens) > 0 && strings.TrimRight(tokens[len(tokens)-1].Value, "\n") == "" {
		tokens = tokens[:len(tokens)-1]
	}
	if len(tokens) > 0 {
		tokens[len(tokens)-1].Value = strings.TrimRight(tokens[len(tokens)-1].Value, "\n")
	}
	for _, token := range tokens {
		for j, part := range strings.Split(token.Value, "\n") {
			if j > 0 {
				w.WriteByte('\n')
				number()
			}
			if part == "" {
				continue
			}
			if class := tokenClass(token.Type); class != "" {
				fmt.Fprintf(w, `<span class="%s">%s</span>`, class, html.EscapeString(part))
			} else {
				w.WriteString(html.EscapeString(part))
			}
		}
	}
	w.WriteString("</code></pre>")
}

func (codeRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(ast.KindFencedCodeBlock, func(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		fence := n.(*ast.FencedCodeBlock)
		lang := string(fence.Language(source))
		info := ""
		if fence.Info != nil {
			info = string(fence.Info.Segment.Value(source))
		}
		attrs, err := blockAttributes(info, []string{"src", "title"})
		if err != nil {
			return ast.WalkStop, fmt.Errorf("code block %q: %w", info, err)
		}
		var code strings.Builder
		for i := 0; i < fence.Lines().Len(); i++ {
			line := fence.Lines().At(i)
			code.Write(line.Value(source))
		}
		header, first := "", 0
		if src := attrs["src"]; src != "" {
			m := githubBlob.FindStringSubmatch(src)
			if m == nil {
				return ast.WalkStop, fmt.Errorf("code block src %q: use a GitHub blob permalink with a commit hash", src)
			}
			lines := ""
			if m[3] != "" {
				first, _ = strconv.Atoi(m[3])
				lines = "L" + m[3]
				if m[4] != "" && m[4] != m[3] {
					lines += "–" + m[4]
				}
				lines += " · "
			}
			title := ""
			if attrs["title"] != "" {
				title = "<span>" + html.EscapeString(attrs["title"]) + "</span>"
			}
			header = fmt.Sprintf(`<figcaption><span class="code-path"><b>%s</b>%s</span><a href="%s">%s%s ↗</a></figcaption>`, html.EscapeString(m[2]), title, html.EscapeString(src), lines, m[1][:7])
		}
		lexer := lexers.Get(lang)
		if lexer == nil {
			lexer = lexers.Fallback
		}
		tokens, err := chroma.Coalesce(lexer).Tokenise(nil, code.String())
		if err != nil {
			return ast.WalkStop, err
		}
		fmt.Fprintf(w, `<figure class="code">%s`, header)
		highlight(w, tokens.Tokens(), first)
		if header == "" && lang != "" && lang != "text" {
			fmt.Fprintf(w, `<span class="lang">%s</span>`, html.EscapeString(lang))
		}
		_, err = w.WriteString("</figure>\n")
		return ast.WalkSkipChildren, err
	})
}
