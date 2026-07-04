import { describe, expect, it } from 'vitest'
import { extractTocHeadings } from '@/lib/toc'

describe('extractTocHeadings', () => {
  it('collects headings with depth and slug urls', () => {
    const headings = extractTocHeadings('# Title\n\n## Subsection\n\ncontent')
    expect(headings).toEqual([
      { value: 'Title', url: '#title', depth: 1 },
      { value: 'Subsection', url: '#subsection', depth: 2 },
    ])
  })

  it('ignores heading-like text inside fenced code blocks', () => {
    const markdown = ['# Real', '```', '# not a heading inside code', '```', '## After'].join('\n')
    const headings = extractTocHeadings(markdown)
    expect(headings.map((h) => h.value)).toEqual(['Real', 'After'])
  })

  it('ignores fenced blocks delimited with tildes', () => {
    const markdown = ['# Real', '~~~', '# inside', '~~~'].join('\n')
    const headings = extractTocHeadings(markdown)
    expect(headings.map((h) => h.value)).toEqual(['Real'])
  })

  it('strips inline markdown from heading text', () => {
    const headings = extractTocHeadings('# `code` and [a link](https://x.com) here')
    expect(headings[0].value).toBe('code and a link here')
  })

  it('skips lines that are not headings', () => {
    const headings = extractTocHeadings('plain text\n\n- not a heading\n')
    expect(headings).toEqual([])
  })
})
