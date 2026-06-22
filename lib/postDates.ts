type PostDateLike = {
  date: string
  gitUpdatedAt?: string
  lastmod?: string
}

export function getPostPublishedDate(post: Pick<PostDateLike, 'date'>) {
  return post.date
}

export function getPostModifiedDate(post: PostDateLike) {
  return post.gitUpdatedAt || post.lastmod || post.date
}

export function latestDate(dates: string[]) {
  return dates
    .filter(Boolean)
    .sort((first, second) => new Date(second).getTime() - new Date(first).getTime())[0]
}
