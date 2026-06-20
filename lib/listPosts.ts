import type { Blog } from 'contentlayer/generated'

export type BlogListPost = Pick<
  Blog,
  | 'title'
  | 'date'
  | 'categories'
  | 'tags'
  | 'summary'
  | 'image'
  | 'slug'
  | 'locale'
  | 'path'
  | 'readingTime'
> & {
  bodyCode?: string
}

type BodyCodeSelector = 'all' | 'none' | ((post: Blog) => boolean)

type ToListPostsOptions = {
  includeBodyCode?: BodyCodeSelector
}

function shouldIncludeBodyCode(post: Blog, selector: BodyCodeSelector) {
  if (selector === 'all') return true
  if (selector === 'none') return false
  return selector(post)
}

export function toListPosts(posts: Blog[], options: ToListPostsOptions = {}): BlogListPost[] {
  const includeBodyCode = options.includeBodyCode || 'none'

  return posts.map((post) => ({
    title: post.title,
    date: post.date,
    categories: post.categories,
    tags: post.tags,
    summary: post.summary,
    image: post.image,
    slug: post.slug,
    locale: post.locale,
    path: post.path,
    readingTime: post.readingTime,
    ...(shouldIncludeBodyCode(post, includeBodyCode) ? { bodyCode: post.body.code } : {}),
  }))
}
