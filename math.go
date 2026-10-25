package main

import (
	"bytes"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/wyatt915/treeblood"
	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// LaTeX between $…$ (inline) or on $$ lines (display) becomes MathML at build time.
type mathExtension struct{}

var (
	kindMath      = ast.NewNodeKind("Math")
	kindMathBlock = ast.NewNodeKind("MathBlock")
	mathIndent    = regexp.MustCompile(`\n\s*`)
	mathTag       = regexp.MustCompile(`<[a-z]+((?:\s+[\w:-]+="[^"]*")+)`)
	mathAttribute = regexp.MustCompile(`[\w:-]+="[^"]*"`)
)

type mathInline struct {
	ast.BaseInline
	TeX []byte
}

func (n *mathInline) Kind() ast.NodeKind                            { return kindMath }
func (n *mathInline) Dump(source []byte, level int)                 { ast.DumpHelper(n, source, level, nil, nil) }
func (n *mathBlock) Kind() ast.NodeKind                             { return kindMathBlock }
func (n *mathBlock) Dump(source []byte, level int)                  { ast.DumpHelper(n, source, level, nil, nil) }
func (n *mathBlock) IsRaw() bool                                    { return true }
func (mathInlineParser) Trigger() []byte                            { return []byte{'$'} }
func (mathBlockParser) Trigger() []byte                             { return []byte{'$'} }
func (mathBlockParser) CanInterruptParagraph() bool                 { return true }
func (mathBlockParser) CanAcceptIndentedLine() bool                 { return false }
func (mathBlockParser) Close(ast.Node, text.Reader, parser.Context) {}

type mathBlock struct{ ast.BaseBlock }
type mathInlineParser struct{}
type mathBlockParser struct{}
type mathRenderer struct{}

func (mathExtension) Extend(m goldmark.Markdown) {
	m.Parser().AddOptions(
		parser.WithInlineParsers(util.Prioritized(mathInlineParser{}, 500)),
		parser.WithBlockParsers(util.Prioritized(mathBlockParser{}, 700)),
	)
	m.Renderer().AddOptions(renderer.WithNodeRenderers(util.Prioritized(mathRenderer{}, 500)))
}

// Pandoc's rule keeps prices literal: no space after the opening $, and the
// closing $ follows a non-space and is not followed by a digit ($5 and $10).
func (mathInlineParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, _ := block.PeekLine()
	fence := 1
	if len(line) > 1 && line[1] == '$' {
		fence = 2
	}
	body := line[fence:]
	if len(body) == 0 || body[0] == ' ' || body[0] == '\t' || body[0] == '$' {
		return nil
	}
	for i := 1; i < len(body); i++ {
		switch {
		case body[i] == '\\':
			i++
		case body[i] == '`':
			return nil // a code span starts first; never wrap it in math
		case body[i] != '$' || body[i-1] == ' ' || body[i-1] == '\t':
		case fence == 2 && (i+1 >= len(body) || body[i+1] != '$'):
		case fence == 1 && i+1 < len(body) && body[i+1] >= '0' && body[i+1] <= '9':
		default:
			block.Advance(fence + i + fence)
			return &mathInline{TeX: body[:i]}
		}
	}
	return nil
}

func (mathBlockParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, _ := reader.PeekLine()
	if pos := pc.BlockOffset(); pos < 0 || string(bytes.TrimSpace(line[pos:])) != "$$" {
		return nil, parser.NoChildren
	}
	reader.AdvanceToEOL()
	return &mathBlock{}, parser.NoChildren
}

func (mathBlockParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	line, segment := reader.PeekLine()
	if string(bytes.TrimSpace(line)) == "$$" {
		reader.AdvanceToEOL()
		return parser.Close
	}
	node.Lines().Append(segment)
	reader.AdvanceToEOL()
	return parser.Continue | parser.NoChildren
}

func (mathRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(kindMath, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			// A <math> box never wraps; the span lets long formulas scroll on phones.
			_, _ = w.WriteString(`<span class="math-inline">`)
			err := writeMath(w, string(n.(*mathInline).TeX), false)
			_, _ = w.WriteString("</span>")
			return ast.WalkSkipChildren, err
		}
		return ast.WalkContinue, nil
	})
	r.Register(kindMathBlock, func(w util.BufWriter, source []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		var tex bytes.Buffer
		for i := 0; i < n.Lines().Len(); i++ {
			line := n.Lines().At(i)
			tex.Write(line.Value(source))
		}
		_, _ = w.WriteString(`<div class="math" tabindex="0">`)
		err := writeMath(w, tex.String(), true)
		_, _ = w.WriteString("</div>\n")
		return ast.WalkSkipChildren, err
	})
}

// Unsupported commands fail the build instead of shipping a red <merror>.
func writeMath(w util.BufWriter, tex string, display bool) error {
	render := treeblood.InlineStyle
	if display {
		render = treeblood.DisplayStyle
	}
	mathML, err := render(strings.TrimSpace(tex), nil)
	if err == nil && strings.Contains(mathML, "<merror") {
		err = fmt.Errorf("unsupported command")
	}
	if err != nil {
		return fmt.Errorf("math %q: %w", tex, err)
	}
	_, err = w.WriteString(sortedAttributes(mathIndent.ReplaceAllString(strings.TrimSpace(mathML), "")))
	return err
}

// sortedAttributes orders each tag's attributes and style declarations by name.
// treeblood writes both from Go maps, so the same formula would otherwise
// render differently on every build.
func sortedAttributes(mathML string) string {
	return mathTag.ReplaceAllStringFunc(mathML, func(tag string) string {
		attrs := mathAttribute.FindAllString(tag, -1)
		for i, a := range attrs {
			if value, ok := strings.CutPrefix(a, `style="`); ok {
				rules := strings.Split(strings.Trim(strings.TrimSuffix(value, `"`), ";"), ";")
				slices.Sort(rules)
				attrs[i] = `style="` + strings.Join(rules, ";") + `;"`
			}
		}
		slices.Sort(attrs)
		name, _, _ := strings.Cut(tag, " ")
		return name + " " + strings.Join(attrs, " ")
	})
}
