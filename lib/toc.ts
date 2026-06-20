import GithubSlugger from 'github-slugger'

export type TocHeading = {
  value: string
  url: string
  depth: number
}

function stripMarkdown(value: string) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim()
}

export function extractTocHeadings(markdown: string): TocHeading[] {
  const slugger = new GithubSlugger()
  const headings: TocHeading[] = []
  let fenced = false

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) {
      continue
    }

    const match = /^(#{1,6})\s+(.+)$/.exec(line)

    if (!match) {
      continue
    }

    const value = stripMarkdown(match[2])

    if (value) {
      headings.push({
        value,
        url: `#${slugger.slug(value)}`,
        depth: match[1].length,
      })
    }
  }

  return headings
}
