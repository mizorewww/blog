'use client'

import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import CollapsiblePanel from '@/components/animata/CollapsiblePanel'
import { animataDuration, animataEase } from '@/components/animata/motion'
import Icon from '@/components/Icon'
import Link from '@/components/Link'
import {
  ancestorFolderPaths,
  collectFolderPaths,
  type ContentTreeFolderNode,
  type ContentTreeNode,
  type ContentTreePostNode,
} from '@/lib/content/contentTree'
import { type Locale, ui } from '@/lib/i18n'

export default function ContentTree({
  nodes,
  locale,
  currentSlug,
  chrome,
  interactive = true,
  flight = false,
  openFolderPaths,
}: {
  nodes: ContentTreeNode[]
  locale: Locale
  currentSlug?: string
  chrome: 'sidebar' | 'rail'
  interactive?: boolean
  flight?: boolean
  openFolderPaths?: readonly string[]
}) {
  const labels = ui[locale]
  const defaultOpen = useMemo(() => {
    if (openFolderPaths) {
      return new Set(openFolderPaths)
    }

    const open = new Set(collectFolderPaths(nodes))

    if (currentSlug) {
      for (const path of ancestorFolderPaths(currentSlug)) {
        open.add(path)
      }
    }

    return open
  }, [currentSlug, nodes, openFolderPaths])
  const [openFolders, setOpenFolders] = useState(defaultOpen)

  const toggleFolder = (path: string) => {
    if (!interactive) {
      return
    }

    setOpenFolders((current) => {
      const next = new Set(current)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  return (
    <nav
      data-content-tree
      data-content-tree-chrome={chrome}
      data-content-tree-flight={flight ? 'true' : undefined}
      data-content-tree-payload={JSON.stringify(nodes)}
      aria-label={labels.contentNav}
    >
      <h2 className="sr-only">{labels.contentNav}</h2>
      <TreeList
        chrome={chrome}
        currentSlug={currentSlug}
        flight={flight}
        interactive={interactive}
        nodes={nodes}
        openFolders={openFolders}
        onToggle={toggleFolder}
      />
    </nav>
  )
}

function TreeList({
  chrome,
  currentSlug,
  depth = 0,
  flight,
  interactive,
  nodes,
  onToggle,
  openFolders,
}: {
  chrome: 'sidebar' | 'rail'
  currentSlug?: string
  depth?: number
  flight: boolean
  interactive: boolean
  nodes: ContentTreeNode[]
  onToggle: (path: string) => void
  openFolders: Set<string>
}) {
  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'mt-0.5 space-y-0.5'}>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <FolderRow
            key={node.path}
            chrome={chrome}
            currentSlug={currentSlug}
            depth={depth}
            flight={flight}
            folder={node}
            interactive={interactive}
            open={openFolders.has(node.path)}
            openFolders={openFolders}
            onToggle={onToggle}
          />
        ) : (
          <PostRow
            key={node.path}
            chrome={chrome}
            currentSlug={currentSlug}
            depth={depth}
            interactive={interactive}
            post={node}
          />
        )
      )}
    </ul>
  )
}

function FolderRow({
  chrome,
  currentSlug,
  depth,
  flight,
  folder,
  interactive,
  onToggle,
  open,
  openFolders,
}: {
  chrome: 'sidebar' | 'rail'
  currentSlug?: string
  depth: number
  flight: boolean
  folder: ContentTreeFolderNode
  interactive: boolean
  onToggle: (path: string) => void
  open: boolean
  openFolders: Set<string>
}) {
  const shouldReduceMotion = useReducedMotion()
  const panelId = `content-tree-${folder.path.replace(/[^\w-]+/g, '-')}`
  const density = chrome === 'rail' ? 'text-[0.8125rem] leading-[1.45]' : 'text-sm leading-6'
  const nestedList = (
    <TreeList
      chrome={chrome}
      currentSlug={currentSlug}
      depth={depth + 1}
      flight={flight}
      interactive={interactive}
      nodes={folder.children}
      openFolders={openFolders}
      onToggle={onToggle}
    />
  )

  return (
    <li data-content-tree-folder={folder.path} data-content-tree-open={open ? 'true' : 'false'}>
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        disabled={!interactive}
        onClick={() => onToggle(folder.path)}
        className={`flex min-h-11 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-slate-700 transition-colors duration-150 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default dark:text-white/80 dark:hover:text-sky-300 ${density}`}
        style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
      >
        <motion.span
          aria-hidden="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
          initial={flight ? false : undefined}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{
            duration: flight || shouldReduceMotion ? 0 : animataDuration,
            ease: animataEase,
          }}
        >
          <Icon name="ChevronRight" className="h-3.5 w-3.5" inlineSpacing={false} decorative />
        </motion.span>
        {open ? (
          <Icon
            name="FolderOpen"
            className="h-4 w-4 text-slate-500 dark:text-white/55"
            inlineSpacing={false}
            decorative
          />
        ) : (
          <Icon
            name="Folder"
            className="h-4 w-4 text-slate-500 dark:text-white/55"
            inlineSpacing={false}
            decorative
          />
        )}
        <span className="min-w-0 truncate">{folder.name}</span>
      </button>
      {flight ? (
        open ? (
          <div id={panelId} className="min-w-0">
            {nestedList}
          </div>
        ) : null
      ) : (
        <CollapsiblePanel id={panelId} open={open} contentClassName="min-w-0">
          {nestedList}
        </CollapsiblePanel>
      )}
    </li>
  )
}

function PostRow({
  chrome,
  currentSlug,
  depth,
  interactive,
  post,
}: {
  chrome: 'sidebar' | 'rail'
  currentSlug?: string
  depth: number
  interactive: boolean
  post: ContentTreePostNode
}) {
  const current = currentSlug === post.slug
  const density = chrome === 'rail' ? 'text-[0.8125rem] leading-[1.45]' : 'text-sm leading-6'
  const className = `flex min-h-11 items-center gap-1.5 rounded-[6px] px-1.5 ${density} ${
    current
      ? 'font-medium text-sky-700 dark:text-sky-300'
      : 'text-slate-700 hover:text-sky-700 dark:text-white/75 dark:hover:text-sky-300'
  }`
  const content = (
    <>
      <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0" />
      <Icon
        name="FileText"
        className="h-4 w-4 text-slate-500 dark:text-white/55"
        inlineSpacing={false}
        decorative
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">{post.title}</span>
    </>
  )

  return (
    <li>
      {interactive ? (
        <Link
          href={`/${post.path}/`}
          data-blog-post-link
          data-content-tree-post={post.slug}
          aria-current={current ? 'page' : undefined}
          className={className}
          style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
        >
          {content}
        </Link>
      ) : (
        <span
          data-content-tree-post={post.slug}
          className={className}
          style={{ paddingLeft: `${0.375 + depth * 0.75}rem` }}
        >
          {content}
        </span>
      )}
    </li>
  )
}
