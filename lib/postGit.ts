import type { BlogListPost } from '@/lib/listPosts'

export type PostGitCommit = {
  hash?: string
  shortHash?: string
  committedAt?: string
  subject?: string
  url?: string
}

export function getPostGitCommits(commits: BlogListPost['gitCommits']) {
  return Array.isArray(commits)
    ? (commits as PostGitCommit[]).filter((commit) => commit.hash || commit.shortHash)
    : []
}

export function getCommitHash(commit: PostGitCommit) {
  return commit.shortHash || commit.hash?.slice(0, 7) || ''
}

export function getLatestPostGitCommit(post: Pick<BlogListPost, 'gitCommits'>) {
  return getPostGitCommits(post.gitCommits)[0] || null
}
