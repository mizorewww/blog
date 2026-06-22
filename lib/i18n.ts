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
    categories: '分类',
    tags: '标签',
    latest: '最新文章',
    allPosts: '全部文章',
    allCategories: '全部分类',
    allTags: '全部标签',
    articles: '文章',
    words: '万字',
    recentPosts: '最近文章',
    popularTags: '热门标签',
    noPosts: '暂无文章。',
    noCategories: '暂无分类。',
    noTags: '暂无标签。',
    readMore: '继续阅读',
    collapse: '收起文章',
    copyCode: '复制代码',
    copiedCode: '已复制代码',
    copy: '复制',
    copied: '已复制',
    toggleTheme: '切换暗色模式',
    subscribeRss: '订阅 Atom RSS',
    latestCommit: (commitHash: string) => `最新提交 ${commitHash}`,
    notFoundTitle: '抱歉，找不到这个页面。',
    notFoundDescription: '可以回到首页继续浏览其他内容。',
    backToHome: '回到首页',
    backToTop: '回到顶部',
    previousArticle: '上一篇',
    nextArticle: '下一篇',
    publishedOn: '发布于',
    gitUpdated: '更新于',
    gitCommits: '相关提交',
    gitSource: '查看源文',
    gitMore: (count: number) => `另有 ${count} 次提交`,
    discussOnX: '在 X 讨论',
    viewOnGithub: '在 GitHub 查看',
    readMoreLabel: (title: string) => `继续阅读：“${title}”`,
    collapseLabel: (title: string) => `收起文章：“${title}”`,
    postsTagged: (tag: string) => `查看标签为 ${tag} 的文章`,
    postsInCategory: (category: string) => `查看分类为 ${category} 的文章`,
    previousPost: (title: string) => `上一篇：${title}`,
    nextPost: (title: string) => `下一篇：${title}`,
  },
  en: {
    home: 'Home',
    categories: 'Categories',
    tags: 'Tags',
    latest: 'Latest',
    allPosts: 'All Posts',
    allCategories: 'Categories',
    allTags: 'Tags',
    articles: 'Articles',
    words: '10k words',
    recentPosts: 'Recent Posts',
    popularTags: 'Popular Tags',
    noPosts: 'No posts found.',
    noCategories: 'No categories found.',
    noTags: 'No tags found.',
    readMore: 'Read more',
    collapse: 'Collapse post',
    copyCode: 'Copy code',
    copiedCode: 'Copied code',
    copy: 'Copy',
    copied: 'Copied',
    toggleTheme: 'Toggle dark mode',
    subscribeRss: 'Subscribe to Atom RSS',
    latestCommit: (commitHash: string) => `Latest commit ${commitHash}`,
    notFoundTitle: "Sorry, we couldn't find this page.",
    notFoundDescription: 'You can return to the homepage and keep browsing.',
    backToHome: 'Back to homepage',
    backToTop: 'Back to top',
    previousArticle: 'Previous Article',
    nextArticle: 'Next Article',
    publishedOn: 'Published on',
    gitUpdated: 'Updated',
    gitCommits: 'Related commits',
    gitSource: 'View source',
    gitMore: (count: number) => `+${count} more`,
    discussOnX: 'Discuss on X',
    viewOnGithub: 'View on GitHub',
    readMoreLabel: (title: string) => `Read more: "${title}"`,
    collapseLabel: (title: string) => `Collapse post: "${title}"`,
    postsTagged: (tag: string) => `View posts tagged ${tag}`,
    postsInCategory: (category: string) => `View posts in ${category}`,
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

export function withTrailingSlash(pathname: string): string {
  if (pathname === '/') {
    return pathname
  }

  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function localizePath(pathname: string, locale: Locale): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  const stripped = stripLocaleFromPathname(normalized)

  if (stripped === '/') {
    return `/${locale}/`
  }

  return withTrailingSlash(`/${locale}${stripped}`)
}

export function switchLocalePath(pathname: string, locale: Locale): string {
  return localizePath(stripLocaleFromPathname(pathname), locale)
}

export function switchLocalePathForSection(pathname: string, locale: Locale): string {
  const strippedPath = stripLocaleFromPathname(pathname)

  if (/^\/(categories|tags)\/[^/]+/.test(strippedPath)) {
    const section = strippedPath.split('/')[1]
    return localizePath(`/${section}`, locale)
  }

  return switchLocalePath(pathname, locale)
}
