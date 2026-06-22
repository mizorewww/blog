import Icon from '@/components/Icon'
import type { ReactNode } from 'react'

const iconClass = 'h-4 w-4 shrink-0 opacity-70'

export type PostMetaIconName =
  | 'calendar'
  | 'chevronDown'
  | 'chevronUp'
  | 'clock'
  | 'code'
  | 'gitCommit'
  | 'tag'

const metaIconNames: Record<PostMetaIconName, string> = {
  calendar: 'Calendar',
  chevronDown: 'ChevronDown',
  chevronUp: 'ChevronUp',
  clock: 'Clock',
  code: 'Code',
  gitCommit: 'GitCommit',
  tag: 'Tag',
}

export function MetaIcon({ name }: { name: PostMetaIconName }) {
  return <Icon name={metaIconNames[name]} className={iconClass} inlineSpacing={false} />
}

export function MetaItem({ icon, children }: { icon: PostMetaIconName; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <MetaIcon name={icon} />
      <span className="min-w-0">{children}</span>
    </span>
  )
}
