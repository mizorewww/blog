export const locales = ['zh', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale = 'zh' satisfies Locale

export const localeConfig: Record<
  Locale,
  {
    label: string
    htmlLang: string
    dateLocale: string
  }
> = {
  zh: {
    label: '中文',
    htmlLang: 'zh-CN',
    dateLocale: 'zh-CN',
  },
  en: {
    label: 'English',
    htmlLang: 'en-US',
    dateLocale: 'en-US',
  },
}

export const ui = {
  zh: {
    home: '首页',
    blog: '博客',
    tags: '标签',
    latest: '最新文章',
    allPosts: '全部文章',
    allTags: '全部标签',
    backToBlog: '返回博客',
    searchArticles: '搜索文章',
    noPosts: '暂无文章。',
    noTags: '暂无标签。',
    readMore: '继续阅读',
    previousArticle: '上一篇',
    nextArticle: '下一篇',
    publishedOn: '发布于',
    discussOnX: '在 X 讨论',
    viewOnGithub: '在 GitHub 查看',
    readMoreLabel: (title: string) => `继续阅读：“${title}”`,
    postsTagged: (tag: string) => `查看标签为 ${tag} 的文章`,
    previousPost: (title: string) => `上一篇：${title}`,
    nextPost: (title: string) => `下一篇：${title}`,
  },
  en: {
    home: 'Home',
    blog: 'Blog',
    tags: 'Tags',
    latest: 'Latest',
    allPosts: 'All Posts',
    allTags: 'Tags',
    backToBlog: 'Back to the blog',
    searchArticles: 'Search articles',
    noPosts: 'No posts found.',
    noTags: 'No tags found.',
    readMore: 'Read more',
    previousArticle: 'Previous Article',
    nextArticle: 'Next Article',
    publishedOn: 'Published on',
    discussOnX: 'Discuss on X',
    viewOnGithub: 'View on GitHub',
    readMoreLabel: (title: string) => `Read more: "${title}"`,
    postsTagged: (tag: string) => `View posts tagged ${tag}`,
    previousPost: (title: string) => `Previous post: ${title}`,
    nextPost: (title: string) => `Next post: ${title}`,
  },
} as const

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale)
}

export function getLocaleFromPathname(pathname: string): Locale {
  const [, segment] = pathname.split('/')
  return isLocale(segment) ? segment : defaultLocale
}

export function stripLocaleFromPathname(pathname: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const segments = normalized.split('/')
  const maybeLocale = segments[1]

  if (!isLocale(maybeLocale)) {
    return normalized
  }

  const stripped = `/${segments.slice(2).join('/')}`.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

export function localizePath(pathname: string, locale: Locale): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const stripped = stripLocaleFromPathname(normalized)

  if (stripped === '/') {
    return `/${locale}`
  }

  return `/${locale}${stripped}`
}

export function switchLocalePath(pathname: string, locale: Locale): string {
  return localizePath(stripLocaleFromPathname(pathname), locale)
}
