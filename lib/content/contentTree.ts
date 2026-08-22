export type ContentTreePostInput = {
  title: string
  slug: string
  path: string
  date?: string
}

export type ContentTreePostNode = {
  kind: 'post'
  title: string
  slug: string
  path: string
}

export type ContentTreeFolderNode = {
  kind: 'folder'
  name: string
  path: string
  children: ContentTreeNode[]
}

export type ContentTreeNode = ContentTreeFolderNode | ContentTreePostNode

type MutableFolder = {
  kind: 'folder'
  name: string
  path: string
  folders: Map<string, MutableFolder>
  posts: ContentTreePostNode[]
}

function comparePosts(left: ContentTreePostInput, right: ContentTreePostInput) {
  const dateCompare = (right.date || '').localeCompare(left.date || '')

  if (dateCompare !== 0) {
    return dateCompare
  }

  return left.title.localeCompare(right.title, 'en')
}

function freezeFolder(folder: MutableFolder): ContentTreeNode[] {
  const folders = [...folder.folders.values()]
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .map((child) => ({
      kind: 'folder' as const,
      name: child.name,
      path: child.path,
      children: freezeFolder(child),
    }))

  return [...folders, ...folder.posts]
}

export function buildContentTree(posts: ContentTreePostInput[]): ContentTreeNode[] {
  const root: MutableFolder = {
    kind: 'folder',
    name: '',
    path: '',
    folders: new Map(),
    posts: [],
  }

  for (const post of [...posts].sort(comparePosts)) {
    const segments = post.slug.split('/').filter(Boolean)

    if (segments.length === 0) {
      continue
    }

    let current = root

    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]
      const folderPath = segments.slice(0, index + 1).join('/')
      let folder = current.folders.get(name)

      if (!folder) {
        folder = {
          kind: 'folder',
          name,
          path: folderPath,
          folders: new Map(),
          posts: [],
        }
        current.folders.set(name, folder)
      }

      current = folder
    }

    current.posts.push({
      kind: 'post',
      title: post.title,
      slug: post.slug,
      path: post.path,
    })
  }

  return freezeFolder(root)
}

export function collectFolderPaths(nodes: ContentTreeNode[]): string[] {
  const paths: string[] = []

  const walk = (items: ContentTreeNode[]) => {
    for (const node of items) {
      if (node.kind === 'folder') {
        paths.push(node.path)
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return paths
}

export function ancestorFolderPaths(slug: string): string[] {
  const segments = slug.split('/').filter(Boolean)

  if (segments.length < 2) {
    return []
  }

  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

export function isCompactContentTreeNode(value: unknown): value is ContentTreeNode {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as Partial<ContentTreeNode>

  if (node.kind === 'post') {
    return (
      typeof node.title === 'string' &&
      node.title.length > 0 &&
      typeof node.slug === 'string' &&
      node.slug.length > 0 &&
      typeof node.path === 'string' &&
      node.path.length > 0 &&
      !('body' in node) &&
      !('mdxModulePath' in node)
    )
  }

  if (node.kind === 'folder') {
    return (
      typeof node.name === 'string' &&
      node.name.length > 0 &&
      typeof node.path === 'string' &&
      node.path.length > 0 &&
      Array.isArray(node.children) &&
      node.children.every(isCompactContentTreeNode)
    )
  }

  return false
}

export function parseContentTreeNodes(value: unknown): ContentTreeNode[] | null {
  if (!Array.isArray(value) || !value.every(isCompactContentTreeNode)) {
    return null
  }

  return value
}
