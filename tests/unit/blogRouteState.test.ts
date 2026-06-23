import { afterEach, describe, expect, it } from 'vitest'
import {
  isBlogPostPath,
  isHomePath,
  isPendingBlogRouteMotion,
  normalizePathname,
  setBlogListReturnContext,
  setPendingBlogCollapseMotion,
  setPendingBlogNavigationMotion,
} from '@/lib/blogRouteState'

const pendingMotionStorageKey = 'mizore:pending-blog-navigation-motion'

function createStorage() {
  let values = new Map<string, string>()

  return {
    clear: () => {
      values = new Map()
    },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    get length() {
      return values.size
    },
  } as Storage
}

function installBrowserState({
  historyState = {},
  pathname = '/zh/example-post',
}: {
  historyState?: unknown
  pathname?: string
} = {}) {
  const sessionStorage = createStorage()
  const history = {
    state: historyState,
    replaceState: (nextState: unknown) => {
      history.state = nextState
    },
  }
  const testWindow = {
    history,
    location: {
      hash: '',
      origin: 'https://example.com',
      pathname,
      search: '',
    },
    sessionStorage,
  }

  sessionStorage.setItem(
    pendingMotionStorageKey,
    JSON.stringify({
      createdAt: 0,
      motion: 'expand',
      postPath: 'expired-post',
      previousCardTop: null,
      previousScrollY: null,
      targetPath: '/zh/expired-post/',
    })
  )

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
  })

  return testWindow
}

describe('blog route state helpers', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('normalizes trailing slashes and missing leading slash', () => {
    expect(normalizePathname('zh/post/')).toBe('/zh/post')
    expect(normalizePathname('/')).toBe('/')
  })

  it('detects localized home paths', () => {
    expect(isHomePath('/')).toBe(true)
    expect(isHomePath('/zh/')).toBe(true)
    expect(isHomePath('/en')).toBe(true)
    expect(isHomePath('/zh/post')).toBe(false)
  })

  it('excludes term routes from blog post paths', () => {
    expect(isBlogPostPath('/zh/example')).toBe(true)
    expect(isBlogPostPath('/zh/tags')).toBe(false)
    expect(isBlogPostPath('/zh/tags/nextjs')).toBe(false)
    expect(isBlogPostPath('/zh/categories/折腾')).toBe(false)
  })

  it('marks pending article expansion as article-owned route motion', () => {
    installBrowserState()

    setPendingBlogNavigationMotion('example-post', '/zh/example-post/', {
      previousCardTop: 120,
      previousScrollY: 400,
      previousUrl: '/zh/',
    })

    expect(isPendingBlogRouteMotion('/zh/', '/zh/example-post/')).toBe(true)
  })

  it('marks pending article collapse as article-owned route motion', () => {
    installBrowserState()

    setPendingBlogCollapseMotion('example-post', '/zh/', {
      previousCardTop: 120,
      previousScrollY: 400,
      previousUrl: '/zh/',
    })

    expect(isPendingBlogRouteMotion('/zh/example-post/', '/zh/')).toBe(true)
  })

  it('marks browser Back list-return state as article-owned route motion', () => {
    installBrowserState({
      historyState: {
        blogListReturn: {
          postPath: 'example-post',
          previousCardTop: 120,
          previousScrollY: 400,
          previousUrl: '/zh/',
        },
      },
    })

    expect(isPendingBlogRouteMotion('/zh/example-post/', '/zh/')).toBe(true)
  })

  it('marks stored list-return context as article-owned route motion', () => {
    installBrowserState()

    setBlogListReturnContext('example-post', {
      previousCardTop: 120,
      previousScrollY: 400,
      previousUrl: '/zh/',
    })

    expect(isPendingBlogRouteMotion('/zh/example-post/', '/zh/')).toBe(true)
  })

  it('does not mark direct article navigation to tags as article-owned route motion', () => {
    installBrowserState()

    setBlogListReturnContext('example-post', {
      previousCardTop: 120,
      previousScrollY: 400,
      previousUrl: '/zh/',
    })

    expect(isPendingBlogRouteMotion('/zh/example-post/', '/zh/tags/')).toBe(false)
  })
})
