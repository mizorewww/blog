import type { Blog } from 'contentlayer/generated'
import { coreContent } from 'pliny/utils/contentlayer'
import type { CoreContent } from 'pliny/utils/contentlayer'

export type BlogListPost = CoreContent<Blog> & {
  bodyCode?: string
}

export function toListPosts(posts: Blog[]): BlogListPost[] {
  return posts.map((post) => ({
    ...coreContent(post),
    bodyCode: post.body.code,
  }))
}
