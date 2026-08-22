import { describe, expect, it } from 'vitest'
import {
  ancestorFolderPaths,
  buildContentTree,
  collectFolderPaths,
  parseContentTreeNodes,
} from '@/lib/content/contentTree'

const posts = [
  {
    title: 'Xiaomi Book',
    slug: 'hardware/xiaomi-book-pro-14',
    path: 'zh/hardware/xiaomi-book-pro-14',
    date: '2026-05-10',
  },
  {
    title: 'Telegram notes',
    slug: 'telegram/making-memoh-cheaper-on-telegram',
    path: 'zh/telegram/making-memoh-cheaper-on-telegram',
    date: '2026-04-01',
  },
  {
    title: 'Root note',
    slug: 'standalone',
    path: 'zh/standalone',
    date: '2026-06-01',
  },
]

describe('buildContentTree', () => {
  it('nests posts by slug segments and keeps a compact projection', () => {
    const tree = buildContentTree(posts)

    expect(tree).toEqual([
      {
        kind: 'folder',
        name: 'hardware',
        path: 'hardware',
        children: [
          {
            kind: 'post',
            title: 'Xiaomi Book',
            slug: 'hardware/xiaomi-book-pro-14',
            path: 'zh/hardware/xiaomi-book-pro-14',
          },
        ],
      },
      {
        kind: 'folder',
        name: 'telegram',
        path: 'telegram',
        children: [
          {
            kind: 'post',
            title: 'Telegram notes',
            slug: 'telegram/making-memoh-cheaper-on-telegram',
            path: 'zh/telegram/making-memoh-cheaper-on-telegram',
          },
        ],
      },
      {
        kind: 'post',
        title: 'Root note',
        slug: 'standalone',
        path: 'zh/standalone',
      },
    ])
    expect(JSON.stringify(tree)).not.toContain('body')
    expect(JSON.stringify(tree)).not.toContain('mdxModulePath')
  })

  it('sorts folders by name and posts by date then title', () => {
    const tree = buildContentTree([
      {
        title: 'Older hardware',
        slug: 'hardware/older',
        path: 'zh/hardware/older',
        date: '2025-01-01',
      },
      {
        title: 'Newer hardware',
        slug: 'hardware/newer',
        path: 'zh/hardware/newer',
        date: '2026-01-01',
      },
      {
        title: 'Alpha',
        slug: 'alpha/post',
        path: 'zh/alpha/post',
        date: '2024-01-01',
      },
    ])

    expect(tree.map((node) => (node.kind === 'folder' ? node.name : node.title))).toEqual([
      'alpha',
      'hardware',
    ])
    const hardware = tree[1]
    expect(hardware.kind).toBe('folder')
    if (hardware.kind === 'folder') {
      expect(hardware.children.map((child) => child.kind === 'post' && child.title)).toEqual([
        'Newer hardware',
        'Older hardware',
      ])
    }
  })

  it('returns an empty tree for empty input', () => {
    expect(buildContentTree([])).toEqual([])
  })
})

describe('content tree helpers', () => {
  it('collects folder paths and ancestors of the current post', () => {
    const tree = buildContentTree(posts)

    expect(collectFolderPaths(tree)).toEqual(['hardware', 'telegram'])
    expect(ancestorFolderPaths('hardware/xiaomi-book-pro-14')).toEqual(['hardware'])
    expect(ancestorFolderPaths('standalone')).toEqual([])
  })

  it('rejects payloads that carry article bodies', () => {
    expect(
      parseContentTreeNodes([
        {
          kind: 'post',
          title: 'Xiaomi Book',
          slug: 'hardware/xiaomi-book-pro-14',
          path: 'zh/hardware/xiaomi-book-pro-14',
          body: '# no',
        },
      ])
    ).toBeNull()
    expect(parseContentTreeNodes(buildContentTree(posts))).toEqual(buildContentTree(posts))
  })
})
