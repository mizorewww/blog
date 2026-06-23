import { slug } from 'github-slugger'

export type TermSummary = {
  slug: string
  label: string
  count: number
}

export type TermSummaryMap = Record<string, TermSummary>
export type CountMap = TermSummaryMap

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

function compareTermSummaries(first: TermSummary, second: TermSummary) {
  if (second.count !== first.count) {
    return second.count - first.count
  }

  return first.label.localeCompare(second.label)
}

export function countTerms(posts: TermPost[], field: TermField): TermSummaryMap {
  return posts.reduce<TermSummaryMap>((counts, post) => {
    post[field]?.forEach((term) => {
      const key = termSlug(term)
      const existing = counts[key]

      counts[key] = {
        slug: key,
        label: existing?.label || term,
        count: (existing?.count || 0) + 1,
      }
    })

    return counts
  }, {})
}

export function getTermCounts(posts: TermPost[], field: TermField): TermSummaryMap {
  return countTerms(posts, field)
}

export function getCategoryCounts(posts: TermPost[]): TermSummaryMap {
  return getTermCounts(posts, 'categories')
}

export function getTagCounts(posts: TermPost[]): TermSummaryMap {
  return getTermCounts(posts, 'tags')
}

export function getTermSummaries(posts: TermPost[], field: TermField): TermSummary[] {
  return Object.values(getTermCounts(posts, field)).sort(compareTermSummaries)
}

export function getSortedTermSummaries(counts: TermSummaryMap): TermSummary[] {
  return Object.values(counts).sort(compareTermSummaries)
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
