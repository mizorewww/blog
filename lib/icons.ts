import { CircleHelp, icons, type LucideIcon } from 'lucide-react'

export const iconAliases: Record<string, string> = {
  braces: 'Braces',
  branch: 'GitBranch',
  calendar: 'Calendar',
  code: 'Code',
  commit: 'GitCommit',
  date: 'Calendar',
  diff: 'GitCompare',
  edit: 'Pencil',
  edited: 'Pencil',
  external: 'ExternalLink',
  'external-link': 'ExternalLink',
  file: 'FileCode',
  'file-code': 'FileCode',
  git: 'GitCommit',
  'git-branch': 'GitBranch',
  'git-commit': 'GitCommit',
  'git-compare': 'GitCompare',
  hash: 'Hash',
  history: 'History',
  link: 'Link',
  message: 'MessageSquareText',
  rss: 'Rss',
  scroll: 'ScrollText',
  'scroll-text': 'ScrollText',
  source: 'Code',
  tag: 'Tag',
  tags: 'Tags',
  time: 'Clock',
  update: 'Clock',
  updated: 'Clock',
  up: 'ArrowUp',
}

export function toIconComponentName(value: string) {
  const key = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  if (!key) {
    return 'CircleHelp'
  }

  const alias = iconAliases[key]

  if (alias) {
    return alias
  }

  return key
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
}

export function getIconComponent(value: string) {
  const componentName = toIconComponentName(value)
  const registry = icons as Record<string, LucideIcon | undefined>

  return registry[componentName] || CircleHelp
}
