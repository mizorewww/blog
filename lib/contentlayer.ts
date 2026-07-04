type ContentLike = Record<string, unknown>

export type CoreContent<T extends ContentLike> = Omit<T, 'body' | '_raw' | '_id'>

export function dateSortDesc(a: string | Date, b: string | Date) {
  const first = new Date(a).getTime()
  const second = new Date(b).getTime()

  if (first > second) return -1
  if (first < second) return 1
  return 0
}

export function sortPosts<T extends ContentLike>(posts: T[], dateKey = 'date'): T[] {
  return [...posts].sort((a, b) =>
    dateSortDesc(a[dateKey] as string | Date, b[dateKey] as string | Date)
  )
}

export function coreContent<T extends ContentLike>(content: T): CoreContent<T> {
  const { body, _raw, _id, ...rest } = content

  void body
  void _raw
  void _id

  return rest as CoreContent<T>
}
