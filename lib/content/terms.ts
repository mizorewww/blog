import { slug } from 'github-slugger'

export type CountMap = Record<string, number>

export type TermField = 'categories' | 'tags'
export type TermRouteField = 'category' | 'tag'

export type TermPost = {
  categories?: string[]
  tags?: string[]
}

export function termSlug(term: string) {
  return slug(term)
}

export function formatTermTitle(term: string) {
  if (!term) return term
  return term[0].toUpperCase() + term.split(' ').join('-').slice(1)
}

export function countTerms(posts: TermPost[], field: TermField): CountMap {
  return posts.reduce<CountMap>((counts, post) => {
    post[field]?.forEach((term) => {
      const key = termSlug(term)
      counts[key] = (counts[key] || 0) + 1
    })

    return counts
  }, {})
}

export function getTermCounts(posts: TermPost[], field: TermField): CountMap {
  return countTerms(posts, field)
}

export function getCategoryCounts(posts: TermPost[]): CountMap {
  return getTermCounts(posts, 'categories')
}

export function getTagCounts(posts: TermPost[]): CountMap {
  return getTermCounts(posts, 'tags')
}

export function postHasTerm(post: TermPost, field: TermField, term: string) {
  return post[field]?.some((postTerm) => termSlug(postTerm) === term) || false
}

export function getPostsByCategory<T extends TermPost>(posts: T[], category: string): T[] {
  return getPostsByTerm(posts, 'categories', category)
}

export function getPostsByTag<T extends TermPost>(posts: T[], tag: string): T[] {
  return getPostsByTerm(posts, 'tags', tag)
}

export function getPostsByTerm<T extends TermPost>(
  posts: T[],
  field: TermField,
  term: string
): T[] {
  return posts.filter((post) => postHasTerm(post, field, term))
}

export function getTermRouteField(field: TermField): TermRouteField {
  return field === 'categories' ? 'category' : 'tag'
}

export function getTermKeys(counts: CountMap) {
  return Object.keys(counts)
}
