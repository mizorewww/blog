import type { Blog } from 'contentlayer/generated'

export type BlogListPost = Pick<
  Blog,
  | 'title'
  | 'date'
  | 'lastmod'
  | 'categories'
  | 'tags'
  | 'summary'
  | 'image'
  | 'slug'
  | 'locale'
  | 'path'
  | 'readingTime'
  | 'gitUpdatedAt'
  | 'gitCommits'
  | 'gitCommitCount'
  | 'githubUrl'
>

export function toListPosts(posts: Blog[]): BlogListPost[] {
  return posts.map((post) => ({
    title: post.title,
    date: post.date,
    lastmod: post.lastmod,
    categories: post.categories,
    tags: post.tags,
    summary: post.summary,
    image: post.image,
    slug: post.slug,
    locale: post.locale,
    path: post.path,
    readingTime: post.readingTime,
    gitUpdatedAt: post.gitUpdatedAt,
    gitCommits: post.gitCommits,
    gitCommitCount: post.gitCommitCount,
    githubUrl: post.githubUrl,
  }))
}
