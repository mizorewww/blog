import { expect, test, type Locator, type Page } from '@playwright/test'
import { readingFixtureHtml } from '../../scripts/reading-fixture.mjs'

const ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'
const RICH_ARTICLE_PATH = '/zh/making-memoh-cheaper-on-telegram/'
const IMAGE_ARTICLE_PATH = '/zh/kde-plasma-obsdian-web-clipper/'
const SOURCE_PATH = '/zh/categories/%E6%8A%98%E8%85%BE/'
const CARD_KEY = 'zh/xiaomi-book-pro-14'
const TITLE = '小米Book Pro 14 Linux使用体验'
const BODY_TEXT = '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
const RETURN_LABEL = '返回列表'
const ARTICLE_RETURN_MARKER_KEY = 'mizore:article-return'
const LIGHT_INLINE_CODE_COLOR = 'rgb(76, 79, 105)'
const LIGHT_INLINE_CODE_GRADIENT = 'linear-gradient(oklab(0.997434'
const LIGHT_INLINE_CODE_BORDER = 'oklab(0.869'
const ARTICLE_SHELL_MAX_WIDTH = 1440
const ARTICLE_DESKTOP_TOC_WIDTH = 256
const ARTICLE_DESKTOP_TOC_GAP = 36
const ARTICLE_DESKTOP_TOC_BREAKPOINT = 1024
// Desktop rail measure: 56rem zh / 49rem en. Task A left-aligns the rail at >=1024px.
const ARTICLE_RAIL_MAX_ZH_PX = 56 * 16
const ARTICLE_RAIL_MAX_EN_PX = 49 * 16
const scrollTolerance = 10
const readingEnvironmentInitPages = new WeakSet<Page>()
const CARD_PRESENTATION_MARKERS = [
  'title',
  'git-updated',
  'git-source',
  'summary',
  'date',
  'primary-tag',
  'read-more',
] as const

type ArticleEntry = 'cover' | 'read-more' | 'title'
type Rect = { top: number; left: number; width: number; height: number }
type PresentationItem = Rect & {
  opacity: number
  text: string
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  letterSpacing: string
}
type PointOwnership = {
  targetRect: Rect | null
  point: { x: number; y: number } | null
  pointInViewport: boolean
  topmostLayer: 'overlay-surface' | 'underlay' | 'overlay' | 'header' | 'document' | 'none'
  topmostElement: string
  ownsPoint: boolean
}
type LanguageIndicatorFrame = {
  present: boolean
  opacity: number
  backgroundColor: string
  bounded: boolean
  visibleAtCenter: boolean
  animationCount: number
  width: number
  height: number
}
type TransitionFrame = Rect & {
  time: number
  phase: string
  transform: string
  overlayCount: number
  cover: Rect
  items: Record<string, PresentationItem>
  destinationStage: string
  underlayPresent: boolean
  underlayOpaque: boolean
  destinationOnlyOpacities: number[]
  sharedDestinationOpacities: number[]
  overlayOwnsCoverPoint: boolean
  overlayOwnsReturnControlPoint: boolean
  coverPointOwnership: PointOwnership
  returnControlPointOwnership: PointOwnership
  languageIndicator: LanguageIndicatorFrame
}
type TransitionProbe = {
  startedAt: number
  removedAt: number | null
  frames: TransitionFrame[]
  maxOverlayCount: number
  animatedProperties: string[]
  ariaHidden: string | null
  pointerEvents: string
  position: string
  overlayZ: number
  headerZ: number
  coverObjectFit: string
  snapshotText: string
}
type ThemeName = 'light' | 'dark'
type ReadingLanguage = 'zh' | 'en'
type ReadingViewport = { width: number; height: number }
type ReadingMeasureThreshold = { medianMin: number; medianMax: number; max: number }
type InlineCodeStyleMetrics = {
  color: string
  backgroundColor: string
  backgroundImage: string
  borderColor: string
  borderTopWidth: string
  borderRadius: string
  boxDecorationBreak: string
  fontSize: string
  lineHeight: string
  paddingInlineStart: string
  contrast: number
}
type DesktopTocPaintMetrics = {
  opacity: number
  headingContrast: number
  minContrast: number
  items: { text: string; contrast: number }[]
}

// ---------- shared navigation helpers ----------

function articleCard(page: Page) {
  return page.locator(`[data-post-shell="${CARD_KEY}"]`)
}

function articleEntryLink(page: Page, entry: ArticleEntry) {
  const root = articleCard(page)

  if (entry === 'cover') {
    return root.locator(':scope > a[data-blog-post-link]')
  }

  if (entry === 'title') {
    return root.locator('h2 a[data-blog-post-link]')
  }

  return root.getByRole('link', { name: /继续阅读/ })
}

function returnLink(page: Page) {
  return page.getByRole('link', { name: RETURN_LABEL })
}

async function openArticleFromCategory(
  page: Page,
  entry: ArticleEntry = 'read-more',
  reloadSource = false
) {
  await page.goto(SOURCE_PATH)

  if (reloadSource) {
    await page.reload()
  }

  const link = articleEntryLink(page, entry)

  await expect(link).toHaveAttribute('href', ARTICLE_PATH)
  await link.scrollIntoViewIfNeeded()

  const previousScrollY = await page.evaluate(() => window.scrollY)
  expect(previousScrollY).toBeGreaterThan(0)

  await link.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)

  return previousScrollY
}

async function stableScrollY(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let lastY = window.scrollY
        let stableSince = performance.now()

        const sample = (now: number) => {
          const currentY = window.scrollY

          if (Math.abs(currentY - lastY) > 0.5) {
            lastY = currentY
            stableSince = now
          }

          if (now - stableSince >= 450) {
            resolve(currentY)
            return
          }

          window.requestAnimationFrame(sample)
        }

        window.requestAnimationFrame(sample)
      })
  )
}

async function expectRestoredScrollY(page: Page, expected: number) {
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - expected), {
      timeout: 3000,
    })
    .toBeLessThanOrEqual(scrollTolerance)

  expect(Math.abs((await stableScrollY(page)) - expected)).toBeLessThanOrEqual(scrollTolerance)
}

function parsePx(value: string) {
  return Number.parseFloat(value.replace('px', ''))
}

function readingMeasureThreshold(
  language: ReadingLanguage,
  width: number
): ReadingMeasureThreshold {
  if (language === 'zh') {
    if (width <= 320) return { medianMin: 16, medianMax: 24, max: 28 }
    if (width <= 375) return { medianMin: 18, medianMax: 28, max: 32 }
    if (width <= 640) return { medianMin: 32, medianMax: 44, max: 48 }
    if (width <= 1024) return { medianMin: 36, medianMax: 48, max: 56 }
    // 56rem zh rail at ~1.09-1.125rem yields ~50-66 chars/line.
    return { medianMin: 42, medianMax: 68, max: 74 }
  }

  if (width <= 320) return { medianMin: 24, medianMax: 34, max: 38 }
  if (width <= 375) return { medianMin: 30, medianMax: 42, max: 46 }
  if (width <= 640) return { medianMin: 52, medianMax: 66, max: 70 }
  if (width <= 1024) return { medianMin: 60, medianMax: 82, max: 86 }
  // 49rem en rail at ~1.09-1.125rem yields ~80-100 chars/line.
  return { medianMin: 72, medianMax: 104, max: 110 }
}

function firstProseVisibilityThreshold(width: number) {
  if (width <= 375) return { maxTop: 680, minVisibleHeight: 120 }
  if (width <= 768) return { maxTop: 700, minVisibleHeight: 80 }
  if (width < ARTICLE_DESKTOP_TOC_BREAKPOINT) return { maxTop: 720, minVisibleHeight: 72 }
  // Desktop cover uses the full surface width, so the first paragraph sits lower.
  return { maxTop: 920, minVisibleHeight: 48 }
}

function articleSurfaceWidth(width: number) {
  if (width < 640) {
    return width
  }

  const shellWidth = Math.min(ARTICLE_SHELL_MAX_WIDTH, width - 30)

  if (width < ARTICLE_DESKTOP_TOC_BREAKPOINT) {
    return shellWidth
  }

  return shellWidth - ARTICLE_DESKTOP_TOC_WIDTH - ARTICLE_DESKTOP_TOC_GAP
}

function articleGutterPx(width: number, textScale = 100) {
  const rootPx = 16 * (textScale / 100)
  const vw = width * 0.05
  return Math.min(Math.max(1.25 * rootPx, vw), 2.5 * rootPx)
}

function articleShellLeft(width: number) {
  if (width < 640) {
    return 0
  }

  return (width - Math.min(ARTICLE_SHELL_MAX_WIDTH, width - 30)) / 2
}

async function ensureReadingEnvironmentInit(page: Page) {
  if (readingEnvironmentInitPages.has(page)) {
    return
  }

  await page.addInitScript(() => {
    const options = JSON.parse(window.name || '{}') as {
      __articleReadingEnvironment?: boolean
      selectedTheme?: ThemeName
      selectedTextScale?: number
    }

    if (options.__articleReadingEnvironment !== true || !options.selectedTheme) {
      return
    }

    localStorage.setItem('theme', options.selectedTheme)
    const root = document.documentElement

    root.classList.toggle('light', options.selectedTheme === 'light')
    root.classList.toggle('dark', options.selectedTheme === 'dark')
    root.style.colorScheme = options.selectedTheme

    if (!options.selectedTextScale || options.selectedTextScale === 100) {
      root.style.removeProperty('font-size')
    } else {
      root.style.fontSize = `${options.selectedTextScale}%`
    }
  })
  readingEnvironmentInitPages.add(page)
}

async function applyReadingEnvironment(page: Page, theme: ThemeName, textScale = 100) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  const apply = async () => {
    await page.evaluate(
      ({ selectedTheme, selectedTextScale }) => {
        localStorage.setItem('theme', selectedTheme)
        const root = document.documentElement

        root.classList.toggle('light', selectedTheme === 'light')
        root.classList.toggle('dark', selectedTheme === 'dark')
        root.style.colorScheme = selectedTheme

        if (selectedTextScale === 100) {
          root.style.removeProperty('font-size')
        } else {
          root.style.fontSize = `${selectedTextScale}%`
        }
      },
      { selectedTheme: theme, selectedTextScale: textScale }
    )
  }
  const waitForTheme = async () => {
    await page.waitForFunction(
      (selectedTheme) => {
        const root = document.documentElement

        return root.classList.contains('dark') === (selectedTheme === 'dark')
      },
      theme,
      { timeout: 3000 }
    )
  }

  await apply()
  await waitForTheme()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await apply()
  await waitForTheme()
}

async function openReadingPage(
  page: Page,
  path: string,
  viewport: ReadingViewport,
  theme: ThemeName,
  textScale = 100
) {
  await ensureReadingEnvironmentInit(page)
  await page.evaluate(
    ({ selectedTheme, selectedTextScale }) => {
      window.name = JSON.stringify({
        __articleReadingEnvironment: true,
        selectedTheme,
        selectedTextScale,
      })
    },
    { selectedTheme: theme, selectedTextScale: textScale }
  )
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.goto(path)
  await applyReadingEnvironment(page, theme, textScale)
  await expect(page.locator('[data-article-body]')).toBeVisible()
}

async function injectReadingFixture(page: Page) {
  await page.evaluate((fixtureHtml) => {
    const prose = document.querySelector<HTMLElement>('[data-article-body] .article-prose')

    if (!prose) {
      throw new Error('Missing article prose fixture target')
    }

    prose.innerHTML = fixtureHtml
  }, readingFixtureHtml)
}

async function noPageOverflow(page: Page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
}

async function articleReadingMetrics(page: Page) {
  return page.evaluate(() => {
    const firstParagraph = document.querySelector<HTMLElement>(
      '[data-article-body] .article-prose > p'
    )
    const toc = document.querySelector<HTMLElement>('.article-toc-desktop')
    const surface = document.querySelector<HTMLElement>('[data-article-surface]')

    if (!firstParagraph || !surface) {
      throw new Error('Missing article reading metric target')
    }

    const lineCounts = (() => {
      const range = document.createRange()
      const walker = document.createTreeWalker(firstParagraph, NodeFilter.SHOW_TEXT)
      const lines = new Map<number, { count: number; width: number }>()
      const paragraphLeft = firstParagraph.getBoundingClientRect().left

      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent || ''

        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === '\n') continue

          range.setStart(node, index)
          range.setEnd(node, index + 1)

          for (const rect of range.getClientRects()) {
            if (rect.width === 0 || rect.height === 0) continue

            const top = Math.round(rect.top)
            const current = lines.get(top) || { count: 0, width: 0 }

            current.count += 1
            current.width = Math.max(current.width, rect.right - paragraphLeft)
            lines.set(top, current)
          }
        }
      }

      range.detach()

      return [...lines.values()]
    })()
    const sortedCounts = lineCounts
      .map((line) => line.count)
      .sort((first, second) => first - second)
    const paragraphRect = firstParagraph.getBoundingClientRect()
    const paragraphStyle = getComputedStyle(firstParagraph)
    const surfaceRect = surface.getBoundingClientRect()
    const rawTocRect = toc?.getBoundingClientRect() || null
    const tocVisible =
      !!toc &&
      !!rawTocRect &&
      getComputedStyle(toc).display !== 'none' &&
      rawTocRect.width > 0 &&
      rawTocRect.height > 0
    const tocRect = tocVisible ? rawTocRect : null
    const tocItems = tocVisible
      ? [...toc.querySelectorAll<HTMLElement>('a span')].map((item) => {
          const rect = item.getBoundingClientRect()
          const lineHeight = Number.parseFloat(getComputedStyle(item).lineHeight) || 20

          return {
            clientWidth: item.clientWidth,
            scrollWidth: item.scrollWidth,
            text: item.textContent?.trim() || '',
            lines: Math.max(1, Math.round(rect.height / lineHeight)),
            clipped: item.scrollWidth > item.clientWidth + 1,
          }
        })
      : []
    const groupLeft = Math.min(surfaceRect.left, tocRect?.left ?? surfaceRect.left)
    const groupRight = Math.max(surfaceRect.right, tocRect?.right ?? surfaceRect.right)

    return {
      document: {
        clientWidth: document.documentElement.clientWidth,
        overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      firstParagraph: {
        top: paragraphRect.top,
        bottom: paragraphRect.bottom,
        width: paragraphRect.width,
        visibleHeight:
          Math.min(paragraphRect.bottom, window.innerHeight) - Math.max(paragraphRect.top, 0),
        fontSize: paragraphStyle.fontSize,
        lineHeight: paragraphStyle.lineHeight,
        medianCharsPerLine: sortedCounts[Math.floor(sortedCounts.length / 2)] || 0,
        maxCharsPerLine: sortedCounts.at(-1) || 0,
      },
      toc: tocRect
        ? {
            width: tocRect.width,
            gapFromSurface: surfaceRect.left - tocRect.right,
            leftMargin: tocRect.left,
            shellAligned: true,
            position: getComputedStyle(toc!).position,
            opacity: Number.parseFloat(getComputedStyle(toc!).opacity),
            items: tocItems,
          }
        : null,
      layout: {
        groupCenterOffset: (groupLeft + groupRight) / 2 - window.innerWidth / 2,
        surfaceCenterOffset: (surfaceRect.left + surfaceRect.right) / 2 - window.innerWidth / 2,
        textCenterOffset: (paragraphRect.left + paragraphRect.right) / 2 - window.innerWidth / 2,
        textLeftInset: paragraphRect.left - surfaceRect.left,
      },
    }
  })
}

async function desktopTocPaintMetrics(page: Page): Promise<DesktopTocPaintMetrics | null> {
  return page.evaluate(() => {
    const toc = document.querySelector<HTMLElement>('.article-toc-desktop')
    const rect = toc?.getBoundingClientRect() || null

    if (
      !toc ||
      !rect ||
      getComputedStyle(toc).display === 'none' ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      return null
    }

    type Rgba = { r: number; g: number; b: number; a: number }

    const parseAlpha = (value: string | undefined) =>
      value?.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value || '1')
    const parseLightness = (value: string) =>
      value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value)
    const srgbChannel = (channel: number) => {
      const clamped = Math.min(1, Math.max(0, channel))

      return (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255
    }
    const oklabToRgba = (l: number, a: number, b: number, alpha: number): Rgba => {
      const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
      const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
      const sPrime = l - 0.0894841775 * a - 1.291485548 * b
      const l3 = lPrime ** 3
      const m3 = mPrime ** 3
      const s3 = sPrime ** 3

      return {
        r: srgbChannel(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
        g: srgbChannel(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
        b: srgbChannel(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
        a: alpha,
      }
    }
    const parseColor = (value: string): Rgba | null => {
      const rgb = value.match(
        /rgba?\(\s*([0-9.]+)\s*,?\s+([0-9.]+)\s*,?\s+([0-9.]+)(?:\s*[/,]\s*([0-9.]+%?))?\s*\)/
      )

      if (rgb) {
        return {
          r: Number.parseFloat(rgb[1]),
          g: Number.parseFloat(rgb[2]),
          b: Number.parseFloat(rgb[3]),
          a: parseAlpha(rgb[4]),
        }
      }

      const oklab = value.match(
        /oklab\(\s*([^)\s]+)\s+([^)\s]+)\s+([^)\s/]+)(?:\s*\/\s*([^)\s]+))?\s*\)/
      )

      if (oklab) {
        return oklabToRgba(
          parseLightness(oklab[1]),
          Number.parseFloat(oklab[2]),
          Number.parseFloat(oklab[3]),
          parseAlpha(oklab[4])
        )
      }

      const oklch = value.match(
        /oklch\(\s*([^)\s]+)\s+([^)\s]+)\s+([^)\s/]+)(?:\s*\/\s*([^)\s]+))?\s*\)/
      )

      if (oklch) {
        const hue = (Number.parseFloat(oklch[3]) * Math.PI) / 180
        const chroma = Number.parseFloat(oklch[2])

        return oklabToRgba(
          parseLightness(oklch[1]),
          chroma * Math.cos(hue),
          chroma * Math.sin(hue),
          parseAlpha(oklch[4])
        )
      }

      return null
    }
    const composite = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top.a + bottom.a * (1 - top.a)

      if (alpha === 0) {
        return { r: 0, g: 0, b: 0, a: 0 }
      }

      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      }
    }
    const luminanceChannel = (channel: number) => {
      const normalized = channel / 255

      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }
    const luminance = (color: Rgba) =>
      0.2126 * luminanceChannel(color.r) +
      0.7152 * luminanceChannel(color.g) +
      0.0722 * luminanceChannel(color.b)
    const contrast = (first: Rgba, second: Rgba) => {
      const lighter = Math.max(luminance(first), luminance(second))
      const darker = Math.min(luminance(first), luminance(second))

      return (lighter + 0.05) / (darker + 0.05)
    }
    const effectiveBackground = (target: Element): Rgba => {
      const chain: Element[] = []
      let current: Element | null = target

      while (current) {
        chain.push(current)
        current = current.parentElement
      }

      let result: Rgba = getComputedStyle(document.documentElement).colorScheme.includes('dark')
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 }

      for (const item of chain.reverse()) {
        const color = parseColor(getComputedStyle(item).backgroundColor)

        if (color && color.a > 0) {
          result = composite(color, result)
        }
      }

      return result
    }
    const inheritedOpacity = (target: Element) => {
      let opacity = 1
      let current: Element | null = target

      while (current instanceof HTMLElement) {
        opacity *= Number.parseFloat(getComputedStyle(current).opacity)
        current = current.parentElement
      }

      return opacity
    }
    const renderedContrast = (target: HTMLElement) => {
      const foreground = parseColor(getComputedStyle(target).color)

      if (!foreground) {
        return 0
      }

      const background = effectiveBackground(target)
      const paintedForeground = composite(
        { ...foreground, a: foreground.a * inheritedOpacity(target) },
        background
      )

      return Math.round(contrast(paintedForeground, background) * 100) / 100
    }

    const heading = toc.querySelector<HTMLElement>('h2')
    const items = [...toc.querySelectorAll<HTMLElement>('a span')].map((item) => ({
      text: item.textContent?.trim() || '',
      contrast: renderedContrast(item),
    }))
    const headingContrast = heading ? renderedContrast(heading) : 0
    const contrasts = [headingContrast, ...items.map((item) => item.contrast)]

    return {
      opacity: Number.parseFloat(getComputedStyle(toc).opacity),
      headingContrast,
      minContrast: Math.min(...contrasts),
      items,
    }
  })
}

async function expectDesktopTocPaint(page: Page, label: string) {
  const paint = await desktopTocPaintMetrics(page)

  expect(paint, label).not.toBeNull()
  expect(paint!.opacity, label).toBe(1)
  expect(paint!.headingContrast, `${label} heading`).toBeGreaterThanOrEqual(4.5)
  expect(paint!.minContrast, `${label} minimum`).toBeGreaterThanOrEqual(4.5)

  for (const item of paint!.items) {
    expect(item.contrast, `${label} ${item.text}`).toBeGreaterThanOrEqual(4.5)
  }
}

async function inlineCodeStyleMetrics(
  page: Page,
  selector = '[data-article-body] .article-prose :not(pre) > code'
): Promise<InlineCodeStyleMetrics> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      type Rgba = { r: number; g: number; b: number; a: number }

      const parseColor = (value: string): Rgba | null => {
        const match = value.match(
          /rgba?\(\s*([0-9.]+)\s*,?\s+([0-9.]+)\s*,?\s+([0-9.]+)(?:\s*[/,]\s*([0-9.]+%?))?\s*\)/
        )

        if (!match) {
          return null
        }

        return {
          r: Number.parseFloat(match[1]),
          g: Number.parseFloat(match[2]),
          b: Number.parseFloat(match[3]),
          a: match[4]?.endsWith('%')
            ? Number.parseFloat(match[4]) / 100
            : Number.parseFloat(match[4] || '1'),
        }
      }
      const composite = (top: Rgba, bottom: Rgba): Rgba => {
        const alpha = top.a + bottom.a * (1 - top.a)

        if (alpha === 0) {
          return { r: 0, g: 0, b: 0, a: 0 }
        }

        return {
          r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
          g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
          b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
          a: alpha,
        }
      }
      const luminanceChannel = (channel: number) => {
        const normalized = channel / 255
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      const luminance = (color: Rgba) =>
        0.2126 * luminanceChannel(color.r) +
        0.7152 * luminanceChannel(color.g) +
        0.0722 * luminanceChannel(color.b)
      const contrast = (first: Rgba, second: Rgba) => {
        const lighter = Math.max(luminance(first), luminance(second))
        const darker = Math.min(luminance(first), luminance(second))

        return (lighter + 0.05) / (darker + 0.05)
      }
      const effectiveBackground = (target: Element): Rgba => {
        const chain: Element[] = []
        let current: Element | null = target

        while (current) {
          chain.push(current)
          current = current.parentElement
        }

        let result: Rgba = getComputedStyle(document.documentElement).colorScheme.includes('dark')
          ? { r: 0, g: 0, b: 0, a: 1 }
          : { r: 255, g: 255, b: 255, a: 1 }

        for (const item of chain.reverse()) {
          const color = parseColor(getComputedStyle(item).backgroundColor)

          if (color && color.a > 0) {
            result = composite(color, result)
          }
        }

        return result
      }

      const style = getComputedStyle(element)
      const foreground = parseColor(style.color)

      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        borderTopWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
        boxDecorationBreak:
          style.getPropertyValue('box-decoration-break') ||
          style.getPropertyValue('-webkit-box-decoration-break'),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingInlineStart: style.paddingInlineStart,
        contrast: foreground ? contrast(foreground, effectiveBackground(element)) : 0,
      }
    })
}

async function scrollBoxMetrics(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)

      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: style.overflowX,
        rect: {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        backgroundImage: style.backgroundImage,
        backgroundAttachment: style.backgroundAttachment,
      }
    })
}

async function articleRailAlignmentMetrics(page: Page) {
  return page.locator('[data-article-body] .article-prose').evaluate((root) => {
    const paragraph = root.querySelector<HTMLElement>(':scope > p')
    const surface = document.querySelector<HTMLElement>('[data-article-surface]')

    if (!paragraph || !surface) {
      throw new Error('Missing article rail alignment target')
    }

    const rect = (element: Element) => {
      const bounds = element.getBoundingClientRect()

      return {
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
        height: bounds.height,
      }
    }
    const reference = rect(paragraph)
    const edgeDelta = (name: string, element: Element) => {
      const bounds = rect(element)

      return {
        name,
        left: bounds.left - reference.left,
        right: bounds.right - reference.right,
        width: bounds.width - reference.width,
      }
    }
    const directSelectors = [
      ['h2', ':scope > h2'],
      ['h3', ':scope > h3'],
      ['h4', ':scope > h4'],
      ['h5', ':scope > h5'],
      ['h6', ':scope > h6'],
      ['ul', ':scope > ul'],
      ['ol', ':scope > ol'],
      ['blockquote', ':scope > blockquote'],
      ['details', ':scope > details'],
      ['figure', ':scope > .article-figure'],
      ['figcaption', ':scope > .article-figure figcaption'],
      ['shiki', ':scope > figure[data-rehype-pretty-code-figure]'],
      ['shiki-pre', ':scope > figure[data-rehype-pretty-code-figure] [data-code-pre]'],
      ['table', ':scope > .article-table-scroll'],
      ['math', ":scope > mjx-container[jax='SVG'][display='true']"],
      ['pre', ':scope > pre'],
      ['data-block', ':scope > .article-data-block'],
      ['footnotes', ':scope > .footnotes'],
    ] as const
    const directEdges = directSelectors.flatMap(([name, selector]) => {
      const element = root.querySelector(selector)

      return element ? [edgeDelta(name, element)] : []
    })
    const railEdges = [...document.querySelectorAll<HTMLElement>('.article-content-rail')]
      .filter((element) => {
        const bounds = element.getBoundingClientRect()

        return bounds.width > 0 && bounds.height > 0 && !!element.closest('[data-article-surface]')
      })
      .map((element, index) => edgeDelta(`rail-${index}`, element))
    const scrollSurfaces = [
      'figure[data-rehype-pretty-code-figure] [data-code-pre]',
      '.article-table-scroll',
      "mjx-container[jax='SVG'][display='true']",
      ':scope > pre',
    ].flatMap((selector) => {
      const element = selector.startsWith(':scope')
        ? root.querySelector<HTMLElement>(selector)
        : root.querySelector<HTMLElement>(selector)

      if (!element) {
        return []
      }

      const style = getComputedStyle(element)

      return [
        {
          selector,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
          backgroundImage: style.backgroundImage,
          backgroundAttachment: style.backgroundAttachment,
        },
      ]
    })
    const toc = document.querySelector<HTMLElement>('.article-toc-desktop')
    const tocRect = toc?.getBoundingClientRect()
    const tocVisible =
      !!toc &&
      !!tocRect &&
      getComputedStyle(toc).display !== 'none' &&
      tocRect.width > 0 &&
      tocRect.height > 0
    const surfaceRect = surface.getBoundingClientRect()
    const groupLeft = Math.min(surfaceRect.left, tocVisible ? tocRect!.left : surfaceRect.left)
    const groupRight = Math.max(surfaceRect.right, tocVisible ? tocRect!.right : surfaceRect.right)

    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      directEdges,
      railEdges,
      scrollSurfaces,
      layout: {
        groupCenterOffset: (groupLeft + groupRight) / 2 - window.innerWidth / 2,
        surfaceCenterOffset: (surfaceRect.left + surfaceRect.right) / 2 - window.innerWidth / 2,
        textCenterOffset: (reference.left + reference.right) / 2 - window.innerWidth / 2,
        textLeftInset: reference.left - surfaceRect.left,
        paragraphLeft: reference.left,
        paragraphRight: reference.right,
        surfaceLeft: surfaceRect.left,
        surfaceRight: surfaceRect.right,
      },
      toc: tocVisible
        ? {
            width: tocRect!.width,
            gapFromSurface: surfaceRect.left - tocRect!.right,
            leftMargin: tocRect!.left,
            position: getComputedStyle(toc).position,
            opacity: Number.parseFloat(getComputedStyle(toc).opacity),
            items: [...toc.querySelectorAll<HTMLElement>('a span')].map((item) => {
              const rect = item.getBoundingClientRect()
              const lineHeight = Number.parseFloat(getComputedStyle(item).lineHeight) || 20

              return {
                clientWidth: item.clientWidth,
                scrollWidth: item.scrollWidth,
                text: item.textContent?.trim() || '',
                lines: Math.max(1, Math.round(rect.height / lineHeight)),
                clipped: item.scrollWidth > item.clientWidth + 1,
              }
            }),
          }
        : null,
    }
  })
}

// ---------- transition helpers ----------

function card(page: Page) {
  return page.locator(`[data-article-transition-key="${CARD_KEY}"]`)
}

function transitionEntryLink(page: Page, entry: ArticleEntry) {
  const root = card(page)

  if (entry === 'cover') {
    return root.locator(':scope > a[data-blog-post-link]')
  }

  if (entry === 'title') {
    return root.locator('[data-article-transition-title] a[data-blog-post-link]')
  }

  return root.locator('[data-article-transition-read-more]')
}

async function elementRect(locator: Locator): Promise<Rect> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()

    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  })
}

function destination(width: number, height: number) {
  const mobile = width < 640
  const desktop = width >= ARTICLE_DESKTOP_TOC_BREAKPOINT
  const top = mobile ? 72 : 120
  const shellWidth = mobile ? width : Math.min(ARTICLE_SHELL_MAX_WIDTH, width - 30)
  const surfaceWidth = desktop
    ? shellWidth - ARTICLE_DESKTOP_TOC_WIDTH - ARTICLE_DESKTOP_TOC_GAP
    : shellWidth
  const left = desktop
    ? (width - shellWidth) / 2 + ARTICLE_DESKTOP_TOC_WIDTH + ARTICLE_DESKTOP_TOC_GAP
    : (width - surfaceWidth) / 2

  return {
    top,
    left,
    width: surfaceWidth,
    height: height - top,
    radius: mobile ? 0 : 8,
  }
}

function articleCoverHeight(width: number) {
  return width >= 640 ? width / 2.8 : width / 2
}

function expectRectNear(actual: Rect, expected: Rect, tolerance = 4) {
  expect(Math.abs(actual.top - expected.top)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(tolerance)
}

function expectWithin(value: number, first: number, second: number, tolerance = 4) {
  expect(value).toBeGreaterThanOrEqual(Math.min(first, second) - tolerance)
  expect(value).toBeLessThanOrEqual(Math.max(first, second) + tolerance)
}

async function presentationItem(page: Page, marker: string): Promise<PresentationItem> {
  return page
    .locator(`[data-article-surface] [data-article-transition-${marker}]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)

      return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        opacity: Number.parseFloat(style.opacity),
        text: element.textContent?.trim() || '',
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      }
    })
}

async function installTransitionProbe(page: Page) {
  await page.evaluate(() => {
    const probe: TransitionProbe = {
      startedAt: 0,
      removedAt: null,
      frames: [],
      maxOverlayCount: 0,
      animatedProperties: [],
      ariaHidden: null,
      pointerEvents: '',
      position: '',
      overlayZ: 0,
      headerZ: 0,
      coverObjectFit: '',
      snapshotText: '',
    }
    ;(window as Window & { __articleTransitionProbe?: TransitionProbe }).__articleTransitionProbe =
      probe

    let sampling = false
    const sample = (now: number) => {
      const root = document.querySelector<HTMLElement>('[data-article-transition-overlay]')
      const surface = root?.querySelector<HTMLElement>('[data-article-transition-overlay-surface]')
      const cover = root?.querySelector<HTMLElement>('[data-article-transition-overlay-cover]')

      if (!root || !surface || !cover) {
        if (probe.startedAt !== 0) {
          probe.removedAt = now - probe.startedAt
          observer.disconnect()
        }
        return
      }

      if (probe.startedAt === 0) {
        probe.startedAt = now
        const rootStyle = getComputedStyle(root)
        const header = document.querySelector<HTMLElement>('body header')
        const image = cover.querySelector<HTMLImageElement>('img')

        probe.ariaHidden = root.getAttribute('aria-hidden')
        probe.pointerEvents = rootStyle.pointerEvents
        probe.position = rootStyle.position
        probe.overlayZ = Number.parseInt(rootStyle.zIndex, 10)
        probe.headerZ = header ? Number.parseInt(getComputedStyle(header).zIndex, 10) : 0
        probe.coverObjectFit = image ? getComputedStyle(image).objectFit : ''
        probe.snapshotText = surface.innerText
      }

      const surfaceRect = surface.getBoundingClientRect()
      const coverRect = cover.getBoundingClientRect()
      const destinationRoot = document.querySelector<HTMLElement>(
        '[data-article-transition-destination]'
      )
      const underlay = root.querySelector<HTMLElement>('[data-article-transition-underlay]')
      const underlayStyle = underlay ? getComputedStyle(underlay) : null
      const overlayCount = document.querySelectorAll('[data-article-transition-overlay]').length
      const items = Object.fromEntries(
        Array.from(
          root.querySelectorAll<HTMLElement>('[data-article-transition-overlay-item]')
        ).map((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)

          return [
            element.dataset.articleTransitionOverlayItem || '',
            {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              opacity: Number.parseFloat(style.opacity),
              text: element.textContent?.trim() || '',
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              lineHeight: style.lineHeight,
              letterSpacing: style.letterSpacing,
            },
          ]
        })
      )
      const destinationOnlyOpacities = Array.from(
        document.querySelectorAll<HTMLElement>('main [data-article-transition-destination-only]')
      ).map((element) => Number.parseFloat(getComputedStyle(element).opacity))
      const sharedDestinationOpacities = [
        'title',
        'git-updated',
        'git-source',
        'summary',
        'date',
        'primary-tag',
      ].flatMap((marker) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            `main [data-article-surface] [data-article-transition-${marker}]`
          )
        ).map((element) => Number.parseFloat(getComputedStyle(element).opacity))
      )
      const realCover = document.querySelector<HTMLElement>('[data-article-cover]')
      const returnControl = document.querySelector<HTMLElement>(
        '[data-article-transition-destination-only]'
      )
      const languageIndicator =
        Array.from(
          document.querySelectorAll<HTMLElement>('[data-animata-language-switcher-active]')
        ).find((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          )
        }) || null
      const languageIndicatorOwner = languageIndicator?.parentElement
      const languageIndicatorRect = languageIndicator?.getBoundingClientRect()
      const languageIndicatorOwnerRect = languageIndicatorOwner?.getBoundingClientRect()
      const languageIndicatorStyle = languageIndicator ? getComputedStyle(languageIndicator) : null
      const languageIndicatorCenter = languageIndicatorRect
        ? {
            x: languageIndicatorRect.left + languageIndicatorRect.width / 2,
            y: languageIndicatorRect.top + languageIndicatorRect.height / 2,
          }
        : null
      const languageIndicatorTopmost = languageIndicatorCenter
        ? document.elementFromPoint(languageIndicatorCenter.x, languageIndicatorCenter.y)
        : null
      const overlayPointOwnership = (element: HTMLElement | null): PointOwnership => {
        if (!element) {
          return {
            targetRect: null,
            point: null,
            pointInViewport: false,
            topmostLayer: 'none',
            topmostElement: 'missing-target',
            ownsPoint: false,
          }
        }

        const rect = element.getBoundingClientRect()
        const point = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
        const pointerEvents = root.style.pointerEvents
        root.style.pointerEvents = 'auto'
        const topmost = document.elementFromPoint(point.x, point.y)
        const topmostOverlay = topmost?.closest<HTMLElement>('[data-article-transition-overlay]')
        const topmostLayer: PointOwnership['topmostLayer'] = topmostOverlay
          ? topmost?.closest('[data-article-transition-overlay-surface]')
            ? 'overlay-surface'
            : topmost?.closest('[data-article-transition-underlay]')
              ? 'underlay'
              : 'overlay'
          : topmost?.closest('header')
            ? 'header'
            : topmost
              ? 'document'
              : 'none'
        root.style.pointerEvents = pointerEvents

        return {
          targetRect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          point,
          pointInViewport:
            point.x >= 0 &&
            point.x < window.innerWidth &&
            point.y >= 0 &&
            point.y < window.innerHeight,
          topmostLayer,
          topmostElement:
            topmost instanceof HTMLElement
              ? [
                  topmost.tagName.toLowerCase(),
                  topmost.id ? `#${topmost.id}` : '',
                  typeof topmost.className === 'string' ? topmost.className : '',
                ]
                  .filter(Boolean)
                  .join(':')
              : 'none',
          ownsPoint: topmostOverlay !== null && topmostOverlay !== undefined,
        }
      }
      const coverPointOwnership = overlayPointOwnership(realCover)
      const returnControlPointOwnership = overlayPointOwnership(returnControl)

      probe.maxOverlayCount = Math.max(probe.maxOverlayCount, overlayCount)
      probe.frames.push({
        time: now - probe.startedAt,
        top: surfaceRect.top,
        left: surfaceRect.left,
        width: surfaceRect.width,
        height: surfaceRect.height,
        phase: root.dataset.articleTransitionPhase || '',
        transform: getComputedStyle(surface).transform,
        overlayCount,
        items,
        destinationStage: destinationRoot?.dataset.articleTransitionDestination || '',
        underlayPresent: underlay !== null,
        underlayOpaque:
          underlayStyle !== null &&
          underlayStyle.opacity === '1' &&
          underlayStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
        destinationOnlyOpacities,
        sharedDestinationOpacities,
        overlayOwnsCoverPoint: coverPointOwnership.ownsPoint,
        overlayOwnsReturnControlPoint: returnControlPointOwnership.ownsPoint,
        coverPointOwnership,
        returnControlPointOwnership,
        languageIndicator: {
          present: languageIndicator !== null,
          opacity: languageIndicatorStyle ? Number.parseFloat(languageIndicatorStyle.opacity) : 0,
          backgroundColor: languageIndicatorStyle?.backgroundColor || '',
          bounded:
            languageIndicatorRect !== undefined &&
            languageIndicatorOwnerRect !== undefined &&
            languageIndicatorRect.left >= languageIndicatorOwnerRect.left - 0.5 &&
            languageIndicatorRect.top >= languageIndicatorOwnerRect.top - 0.5 &&
            languageIndicatorRect.right <= languageIndicatorOwnerRect.right + 0.5 &&
            languageIndicatorRect.bottom <= languageIndicatorOwnerRect.bottom + 0.5,
          visibleAtCenter:
            languageIndicatorOwner != null &&
            languageIndicatorTopmost !== null &&
            languageIndicatorOwner.contains(languageIndicatorTopmost),
          animationCount: languageIndicator?.getAnimations().length || 0,
          width: languageIndicatorRect?.width || 0,
          height: languageIndicatorRect?.height || 0,
        },
        cover: {
          top: coverRect.top,
          left: coverRect.left,
          width: coverRect.width,
          height: coverRect.height,
        },
      })

      for (const animation of surface.getAnimations({ subtree: true })) {
        if (!(animation.effect instanceof KeyframeEffect)) continue

        for (const frame of animation.effect.getKeyframes()) {
          for (const property of [
            'transform',
            'translate',
            'scale',
            'opacity',
            'top',
            'left',
            'width',
            'height',
          ]) {
            if (property in frame && !probe.animatedProperties.includes(property)) {
              probe.animatedProperties.push(property)
            }
          }
        }
      }

      window.requestAnimationFrame(sample)
    }
    const observer = new MutationObserver(() => {
      if (!sampling && document.querySelector('[data-article-transition-overlay]')) {
        sampling = true
        window.requestAnimationFrame(sample)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  })
}

async function readProbe(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { __articleTransitionProbe?: TransitionProbe }).__articleTransitionProbe
  )
}

async function waitForProbeRemoval(page: Page) {
  await expect
    .poll(async () => (await readProbe(page))?.removedAt, { timeout: 1_500 })
    .not.toBeNull()

  return (await readProbe(page))!
}

async function openCard(
  page: Page,
  viewport: { width: number; height: number },
  entry: ArticleEntry
) {
  await page.setViewportSize(viewport)
  await page.goto(SOURCE_PATH)

  const root = card(page)
  const link = transitionEntryLink(page, entry)
  await link.scrollIntoViewIfNeeded()

  const source = await elementRect(root)
  const sourceCover = await elementRect(root.locator('[data-article-transition-cover]'))
  const sourceItems = Object.fromEntries(
    await Promise.all(
      CARD_PRESENTATION_MARKERS.map(async (marker) => [
        marker,
        await elementRect(root.locator(`[data-article-transition-${marker}]`)),
      ])
    )
  ) as Record<(typeof CARD_PRESENTATION_MARKERS)[number], Rect>
  const sourceScrollY = await page.evaluate(() => window.scrollY)

  await installTransitionProbe(page)
  await link.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)

  const body = await page.locator('[data-article-body]').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    opacity: Number.parseFloat(getComputedStyle(element).opacity),
  }))
  const probe = await waitForProbeRemoval(page)

  return { source, sourceCover, sourceItems, sourceScrollY, body, probe }
}

// ---------- 文章路由与阅读 ----------

for (const entry of ['cover', 'title', 'read-more'] as const) {
  test(`the ${entry} card entry is an ordinary article link`, async ({ page }) => {
    await openArticleFromCategory(page, entry)

    await expect(page.locator('main article[data-article-reader]')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.locator('[data-post-shell]')).toHaveCount(0)
  })
}

test('direct article entry renders one static reader without a handoff layer', async ({ page }) => {
  const response = await page.goto(ARTICLE_PATH)

  expect(response?.status()).toBe(200)
  await expect(page.locator('main article[data-article-reader]')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
  await expect(page.locator('[data-post-shell]')).toHaveCount(0)
  await expect(
    page
      .locator('[data-article-body]')
      .locator('xpath=ancestor-or-self::*[@data-animata-collapsible]')
  ).toHaveCount(0)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-article-transition-underlay]')).toHaveCount(0)
  await expect(page.locator('main[data-article-transition-destination]')).toHaveCount(0)
  expect(
    await page
      .locator('main [data-article-transition-destination-only]')
      .evaluateAll((elements) =>
        elements.map((element) => Number.parseFloat(getComputedStyle(element).opacity))
      )
  ).toEqual(expect.arrayContaining([1]))

  const link = returnLink(page)
  await expect(link).toHaveAttribute('href', '/zh/')
  await expect(link).toBeInViewport()
})

for (const viewport of [
  { width: 320, height: 720, top: 72, radius: 0 },
  { width: 390, height: 844, top: 72, radius: 0 },
  { width: 1440, height: 900, top: 120, radius: 8 },
] as const) {
  test(`article reading surface is stable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(ARTICLE_PATH)

    const surface = page.locator('[data-article-surface]')
    const body = page.locator('[data-article-body]')
    const close = returnLink(page)

    await expect(surface).toBeVisible()
    await expect(body).toContainText(BODY_TEXT)

    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)

        if (!element) throw new Error(`Missing ${selector}`)

        const bounds = element.getBoundingClientRect()
        return {
          top: bounds.top,
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          height: bounds.height,
        }
      }

      const surfaceElement = document.querySelector<HTMLElement>('[data-article-surface]')
      const bodyElement = document.querySelector<HTMLElement>('[data-article-body]')
      const headerElement = document.querySelector<HTMLElement>('body header')
      const mobileTocElement = document.querySelector<HTMLElement>('.article-toc-mobile')
      const desktopTocElement = document.querySelector<HTMLElement>('.article-toc-desktop')

      if (!surfaceElement || !bodyElement || !headerElement) {
        throw new Error('Missing article geometry target')
      }

      return {
        surface: rect('[data-article-surface]'),
        cover: rect('[data-article-cover]'),
        title: rect('h1'),
        body: rect('[data-article-body]'),
        close: rect('a[aria-label="返回列表"]'),
        radius: Number.parseFloat(getComputedStyle(surfaceElement).borderTopLeftRadius),
        bodyOpacity: Number.parseFloat(getComputedStyle(bodyElement).opacity),
        bodyHeight: bodyElement.getBoundingClientRect().height,
        headerZ: Number.parseInt(getComputedStyle(headerElement).zIndex, 10),
        surfaceZ: Number.parseInt(getComputedStyle(surfaceElement).zIndex, 10),
        mobileToc: mobileTocElement
          ? {
              top: mobileTocElement.getBoundingClientRect().top,
              bottom: mobileTocElement.getBoundingClientRect().bottom,
            }
          : null,
        desktopToc: desktopTocElement
          ? {
              left: desktopTocElement.getBoundingClientRect().left,
              right: desktopTocElement.getBoundingClientRect().right,
              width: desktopTocElement.getBoundingClientRect().width,
              position: getComputedStyle(desktopTocElement).position,
              opacity: Number.parseFloat(getComputedStyle(desktopTocElement).opacity),
            }
          : null,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })

    const expectedWidth = articleSurfaceWidth(viewport.width)
    const expectedLeft = destination(viewport.width, viewport.height).left

    expect(Math.abs(geometry.surface.top - viewport.top)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.surface.left - expectedLeft)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.surface.width - expectedWidth)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.radius - viewport.radius)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.close.width - 44)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.close.height - 44)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.cover.height - articleCoverHeight(geometry.cover.width))).toBeLessThan(
      4
    )
    expect(geometry.cover.top).toBeLessThan(geometry.title.top)
    expect(geometry.cover.right).toBeLessThanOrEqual(geometry.surface.right + 0.5)
    expect(geometry.bodyHeight).toBeGreaterThan(0)
    expect(geometry.bodyOpacity).toBe(1)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.headerZ).toBe(50)
    expect(geometry.surfaceZ).toBeLessThan(geometry.headerZ)

    await expect(close).toHaveAttribute('href', '/zh/')

    if (viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
      await expect(page.locator('.article-toc-desktop')).toBeVisible()
      await expect(surface.locator('.article-toc-desktop')).toHaveCount(0)
      expect(geometry.desktopToc).not.toBeNull()
      expect(Math.abs(geometry.desktopToc!.width - ARTICLE_DESKTOP_TOC_WIDTH)).toBeLessThanOrEqual(
        1
      )
      expect(geometry.surface.left - geometry.desktopToc!.right).toBeGreaterThanOrEqual(
        ARTICLE_DESKTOP_TOC_GAP - 1
      )
      expect(geometry.surface.left - geometry.desktopToc!.right).toBeLessThanOrEqual(
        ARTICLE_DESKTOP_TOC_GAP + 1
      )
      expect(
        Math.abs(geometry.desktopToc!.left - articleShellLeft(viewport.width))
      ).toBeLessThanOrEqual(1)
      expect(geometry.desktopToc!.position).toBe('sticky')
      expect(geometry.desktopToc!.opacity).toBe(1)
      await expectDesktopTocPaint(page, `static surface ${viewport.width}`)
    } else {
      await expect(page.locator('.article-toc-mobile')).toBeVisible()
      await expect(surface.locator('.article-toc-mobile')).toHaveCount(1)
      expect(geometry.mobileToc).not.toBeNull()
      expect(geometry.mobileToc!.top).toBeGreaterThan(geometry.title.top)
      expect(geometry.mobileToc!.bottom).toBeLessThanOrEqual(geometry.body.top)
    }
  })
}

for (const scenario of [
  {
    name: 'zh light desktop',
    path: ARTICLE_PATH,
    theme: 'light' as const,
    viewport: { width: 1440, height: 900 },
    maxParagraphTop: 820,
  },
  {
    name: 'zh dark mobile',
    path: ARTICLE_PATH,
    theme: 'dark' as const,
    viewport: { width: 375, height: 812 },
    maxParagraphTop: 680,
  },
  {
    name: 'en light mobile',
    path: '/en/xiaomi-book-pro-14/',
    theme: 'light' as const,
    viewport: { width: 375, height: 812 },
    maxParagraphTop: 680,
  },
  {
    name: 'en dark desktop',
    path: '/en/xiaomi-book-pro-14/',
    theme: 'dark' as const,
    viewport: { width: 1440, height: 900 },
    maxParagraphTop: 820,
  },
] as const) {
  test(`article prose starts in the first viewport for ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize(scenario.viewport)
    await page.addInitScript((theme) => localStorage.setItem('theme', theme), scenario.theme)
    await page.goto(scenario.path)

    const metrics = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('h1')
      const prose = document.querySelector<HTMLElement>('[data-article-body] .article-prose')
      const firstParagraph = document.querySelector<HTMLElement>(
        '[data-article-body] .article-prose > p'
      )
      const firstBodyH2 = document.querySelector<HTMLElement>(
        '[data-article-body] .article-prose h2'
      )

      if (!title || !prose || !firstParagraph || !firstBodyH2) {
        throw new Error('Missing article reading hierarchy target')
      }

      const paragraphRect = firstParagraph.getBoundingClientRect()
      const titleStyle = getComputedStyle(title)
      const bodyH2Style = getComputedStyle(firstBodyH2)

      return {
        paragraphTop: paragraphRect.top,
        paragraphBottom: paragraphRect.bottom,
        visibleParagraphHeight:
          Math.min(paragraphRect.bottom, window.innerHeight) - Math.max(paragraphRect.top, 0),
        paragraphWidth: paragraphRect.width,
        proseWidth: prose.getBoundingClientRect().width,
        titleFontSize: Number.parseFloat(titleStyle.fontSize),
        bodyH2FontSize: Number.parseFloat(bodyH2Style.fontSize),
        titleLetterSpacing: titleStyle.letterSpacing,
        bodyH2LetterSpacing: bodyH2Style.letterSpacing,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })

    expect(metrics.paragraphTop).toBeLessThan(scenario.maxParagraphTop)
    expect(metrics.paragraphBottom).toBeGreaterThan(0)
    expect(metrics.visibleParagraphHeight).toBeGreaterThan(40)
    const railMaxPx = scenario.path.startsWith('/zh/')
      ? ARTICLE_RAIL_MAX_ZH_PX
      : ARTICLE_RAIL_MAX_EN_PX
    expect(metrics.paragraphWidth).toBeLessThanOrEqual(Math.min(metrics.proseWidth, railMaxPx))
    expect(metrics.titleFontSize).toBeGreaterThan(metrics.bodyH2FontSize + 3)
    expect(['normal', '0px']).toContain(metrics.titleLetterSpacing)
    expect(['normal', '0px']).toContain(metrics.bodyH2LetterSpacing)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
  })
}

test('Reading Max prose rhythm and line measure meet the viewport matrix', async ({ page }) => {
  const routes = [
    { language: 'zh' as const, path: ARTICLE_PATH },
    { language: 'en' as const, path: '/en/xiaomi-book-pro-14/' },
  ]
  const viewports = [
    { width: 320, height: 812 },
    { width: 375, height: 812 },
    { width: 640, height: 900 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1280, height: 960 },
    { width: 1440, height: 960 },
    { width: 1728, height: 960 },
    { width: 1920, height: 960 },
  ]

  for (const route of routes) {
    for (const viewport of viewports) {
      for (const theme of ['light', 'dark'] as const) {
        await openReadingPage(page, route.path, viewport, theme)

        const metrics = await articleReadingMetrics(page)
        const threshold = readingMeasureThreshold(route.language, viewport.width)
        const visibility = firstProseVisibilityThreshold(viewport.width)
        const fontSize = parsePx(metrics.firstParagraph.fontSize)
        const lineHeight = parsePx(metrics.firstParagraph.lineHeight)
        const ratio = lineHeight / fontSize

        expect(
          metrics.document.overflowPx,
          `${route.language} ${theme} ${viewport.width}`
        ).toBeLessThanOrEqual(0)
        expect(fontSize).toBeGreaterThanOrEqual(16)
        expect(ratio).toBeGreaterThanOrEqual(1.62)
        expect(ratio).toBeLessThanOrEqual(1.68)
        expect(metrics.firstParagraph.medianCharsPerLine).toBeGreaterThanOrEqual(
          threshold.medianMin
        )
        expect(metrics.firstParagraph.medianCharsPerLine).toBeLessThanOrEqual(threshold.medianMax)
        expect(metrics.firstParagraph.maxCharsPerLine).toBeLessThanOrEqual(threshold.max)
        expect(
          metrics.firstParagraph.top,
          `${route.language} ${theme} ${viewport.width} top`
        ).toBeLessThanOrEqual(visibility.maxTop)
        expect(
          metrics.firstParagraph.visibleHeight,
          `${route.language} ${theme} ${viewport.width} visible`
        ).toBeGreaterThanOrEqual(visibility.minVisibleHeight)
        if (viewport.width < ARTICLE_DESKTOP_TOC_BREAKPOINT) {
          expect(Math.abs(metrics.layout.surfaceCenterOffset)).toBeLessThanOrEqual(1)
          expect(
            Math.abs(metrics.layout.textCenterOffset - metrics.layout.surfaceCenterOffset)
          ).toBeLessThanOrEqual(1)
        } else {
          const gutter = articleGutterPx(viewport.width)
          expect(metrics.layout.textLeftInset).toBeGreaterThanOrEqual(gutter - 1)
          expect(metrics.layout.textLeftInset).toBeLessThanOrEqual(gutter + 1)
        }

        if (viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
          expect(metrics.toc).not.toBeNull()
          expect(metrics.toc!.width).toBeGreaterThanOrEqual(255)
          expect(metrics.toc!.width).toBeLessThanOrEqual(257)
          expect(metrics.toc!.gapFromSurface).toBeGreaterThanOrEqual(ARTICLE_DESKTOP_TOC_GAP - 1)
          expect(metrics.toc!.gapFromSurface).toBeLessThanOrEqual(ARTICLE_DESKTOP_TOC_GAP + 1)
          expect(
            Math.abs(metrics.toc!.leftMargin - articleShellLeft(viewport.width))
          ).toBeLessThanOrEqual(1)
          expect(metrics.toc!.position).toBe('sticky')
          expect(metrics.toc!.opacity).toBe(1)
          await expectDesktopTocPaint(page, `${route.language} ${theme} ${viewport.width}`)

          for (const item of metrics.toc!.items) {
            expect(item.scrollWidth, item.text).toBeLessThanOrEqual(item.clientWidth + 1)
            expect(item.clipped, item.text).toBe(false)
            expect(item.lines, item.text).toBeLessThanOrEqual(4)
          }
        } else {
          expect(metrics.toc).toBeNull()
        }
      }
    }
  }
})

test('article content families, data blocks, and TOC share the reading rail', async ({ page }) => {
  const scenarios = [
    {
      name: 'rich-mobile',
      path: RICH_ARTICLE_PATH,
      viewport: { width: 320, height: 812 },
      theme: 'dark' as const,
      textScale: 100,
      fixture: false,
      expected: ['h2', 'ul', 'shiki', 'shiki-pre', 'table', 'math', 'data-block'],
    },
    {
      name: 'rich-wide',
      path: RICH_ARTICLE_PATH,
      viewport: { width: 1440, height: 960 },
      theme: 'dark' as const,
      textScale: 100,
      fixture: false,
      expected: ['h2', 'ul', 'shiki', 'shiki-pre', 'table', 'math', 'data-block'],
    },
    {
      name: 'rich-text-200-mobile',
      path: RICH_ARTICLE_PATH,
      viewport: { width: 640, height: 900 },
      theme: 'dark' as const,
      textScale: 200,
      fixture: false,
      expected: ['h2', 'ul', 'shiki', 'shiki-pre', 'table', 'math', 'data-block'],
    },
    {
      name: 'rich-text-200-wide',
      path: RICH_ARTICLE_PATH,
      viewport: { width: 1440, height: 960 },
      theme: 'dark' as const,
      textScale: 200,
      fixture: false,
      expected: ['h2', 'ul', 'shiki', 'shiki-pre', 'table', 'math', 'data-block'],
    },
    {
      name: 'fixture-mobile',
      path: ARTICLE_PATH,
      viewport: { width: 320, height: 812 },
      theme: 'dark' as const,
      textScale: 100,
      fixture: true,
      expected: [
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'blockquote',
        'details',
        'figure',
        'figcaption',
        'table',
        'pre',
        'data-block',
        'footnotes',
      ],
    },
    {
      name: 'fixture-wide',
      path: ARTICLE_PATH,
      viewport: { width: 1920, height: 960 },
      theme: 'light' as const,
      textScale: 100,
      fixture: true,
      expected: [
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'blockquote',
        'details',
        'figure',
        'figcaption',
        'table',
        'pre',
        'data-block',
        'footnotes',
      ],
    },
  ]

  for (const scenario of scenarios) {
    await openReadingPage(
      page,
      scenario.path,
      scenario.viewport,
      scenario.theme,
      scenario.textScale
    )

    if (scenario.fixture) {
      await injectReadingFixture(page)
    }

    const metrics = await articleRailAlignmentMetrics(page)
    const directNames = metrics.directEdges.map((edge) => edge.name)

    expect(metrics.documentOverflow, scenario.name).toBeLessThanOrEqual(0)
    expect(directNames, scenario.name).toEqual(expect.arrayContaining(scenario.expected))
    expect(metrics.railEdges.length, scenario.name).toBeGreaterThan(0)

    const breakoutNames = new Set(['figure', 'shiki', 'shiki-pre', 'table', 'math', 'pre'])
    const captionNames = new Set(['figcaption'])
    const railAlignedEdges = [...metrics.directEdges, ...metrics.railEdges].filter(
      (edge) => !breakoutNames.has(edge.name) && !captionNames.has(edge.name)
    )
    const breakoutEdges = metrics.directEdges.filter((edge) => breakoutNames.has(edge.name))
    const captionEdges = metrics.directEdges.filter((edge) => captionNames.has(edge.name))

    for (const edge of railAlignedEdges) {
      expect(Math.abs(edge.left), `${scenario.name} ${edge.name} left`).toBeLessThanOrEqual(1)
      expect(Math.abs(edge.right), `${scenario.name} ${edge.name} right`).toBeLessThanOrEqual(1)
      expect(Math.abs(edge.width), `${scenario.name} ${edge.name} width`).toBeLessThanOrEqual(1)
    }

    for (const edge of breakoutEdges) {
      expect(edge.width, `${scenario.name} ${edge.name} breakout width`).toBeGreaterThanOrEqual(-1)
      const breakoutLeft = metrics.layout.paragraphLeft + edge.left
      const breakoutRight = metrics.layout.paragraphRight + edge.right
      const leftInset = breakoutLeft - metrics.layout.surfaceLeft
      const rightInset = metrics.layout.surfaceRight - breakoutRight
      expect(
        Math.abs(leftInset - rightInset),
        `${scenario.name} ${edge.name} breakout surface centering`
      ).toBeLessThanOrEqual(2)
    }

    for (const edge of captionEdges) {
      expect(edge.width, `${scenario.name} ${edge.name} caption width`).toBeLessThanOrEqual(1)
      expect(
        Math.abs(edge.left + edge.right),
        `${scenario.name} ${edge.name} caption centering`
      ).toBeLessThanOrEqual(2)
    }

    if (scenario.viewport.width < ARTICLE_DESKTOP_TOC_BREAKPOINT) {
      expect(Math.abs(metrics.layout.surfaceCenterOffset), scenario.name).toBeLessThanOrEqual(1)
      expect(
        Math.abs(metrics.layout.textCenterOffset - metrics.layout.surfaceCenterOffset),
        scenario.name
      ).toBeLessThanOrEqual(1)
    } else {
      const gutter = articleGutterPx(scenario.viewport.width, scenario.textScale)
      expect(metrics.layout.textLeftInset, scenario.name).toBeGreaterThanOrEqual(gutter - 1)
      expect(metrics.layout.textLeftInset, scenario.name).toBeLessThanOrEqual(gutter + 1)
    }

    if (scenario.viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
      expect(metrics.toc, scenario.name).not.toBeNull()
      expect(metrics.toc!.width).toBeGreaterThanOrEqual(255)
      expect(metrics.toc!.width).toBeLessThanOrEqual(257)
      expect(metrics.toc!.gapFromSurface).toBeGreaterThanOrEqual(ARTICLE_DESKTOP_TOC_GAP - 1)
      expect(metrics.toc!.gapFromSurface).toBeLessThanOrEqual(ARTICLE_DESKTOP_TOC_GAP + 1)
      expect(
        Math.abs(metrics.toc!.leftMargin - articleShellLeft(scenario.viewport.width))
      ).toBeLessThanOrEqual(1)
      expect(metrics.toc!.position).toBe('sticky')
      expect(metrics.toc!.opacity).toBe(1)
      await expectDesktopTocPaint(page, scenario.name)

      for (const item of metrics.toc!.items) {
        expect(item.scrollWidth, `${scenario.name} ${item.text}`).toBeLessThanOrEqual(
          item.clientWidth + 1
        )
        expect(item.clipped, `${scenario.name} ${item.text}`).toBe(false)
        expect(item.lines, `${scenario.name} ${item.text}`).toBeLessThanOrEqual(4)
      }
    } else {
      expect(metrics.toc, scenario.name).toBeNull()
    }

    for (const item of metrics.scrollSurfaces) {
      expect(item.backgroundImage, `${scenario.name} ${item.selector}`).toContain('linear-gradient')
      expect(item.backgroundAttachment, `${scenario.name} ${item.selector}`).toContain('local')

      if (item.scrollWidth > item.clientWidth) {
        expect(['auto', 'scroll']).toContain(item.overflowX)
      }
    }
  }
})

test('dark article inline code uses dark tokens while real Shiki blocks keep their styling', async ({
  page,
}) => {
  await openReadingPage(page, ARTICLE_PATH, { width: 375, height: 812 }, 'dark')

  const inlineCode = await inlineCodeStyleMetrics(page)

  expect(inlineCode.color).not.toBe(LIGHT_INLINE_CODE_COLOR)
  expect(inlineCode.backgroundImage).toBe('none')
  expect(inlineCode.backgroundImage).not.toContain(LIGHT_INLINE_CODE_GRADIENT)
  expect(inlineCode.borderColor).not.toContain(LIGHT_INLINE_CODE_BORDER)
  expect(inlineCode.contrast).toBeGreaterThanOrEqual(4.5)
  expect(['clone', '-webkit-clone']).toContain(inlineCode.boxDecorationBreak)

  const shikiCode = await inlineCodeStyleMetrics(
    page,
    'figure[data-rehype-pretty-code-figure] pre code'
  )

  expect(shikiCode.borderTopWidth).toBe('0px')
  expect(shikiCode.borderRadius).toBe('0px')
  expect(shikiCode.backgroundImage).not.toContain(LIGHT_INLINE_CODE_GRADIENT)
  expect(shikiCode.paddingInlineStart).toBe('0px')

  await injectReadingFixture(page)

  const fixtureInlineCode = await inlineCodeStyleMetrics(page, '#reading-fixture-h2 code')
  const linkedCode = await inlineCodeStyleMetrics(page, '[data-article-body] .article-prose a code')

  expect(linkedCode.backgroundColor).toBe(fixtureInlineCode.backgroundColor)
  expect(linkedCode.backgroundImage).toBe(fixtureInlineCode.backgroundImage)
  expect(linkedCode.borderColor).toBe(fixtureInlineCode.borderColor)
  expect(linkedCode.contrast).toBeGreaterThanOrEqual(4.5)
  expect(linkedCode.color).not.toBe(LIGHT_INLINE_CODE_COLOR)
})

test('Reading Max injected Markdown family remains coherent and reflow-safe', async ({ page }) => {
  const viewports = [
    { width: 320, height: 812 },
    { width: 640, height: 900 },
    { width: 768, height: 1024 },
    { width: 1440, height: 960 },
    { width: 1920, height: 960 },
  ]

  for (const viewport of viewports) {
    for (const theme of ['light', 'dark'] as const) {
      await openReadingPage(page, ARTICLE_PATH, viewport, theme)
      await injectReadingFixture(page)

      const metrics = await page.locator('[data-article-body] .article-prose').evaluate((root) => {
        const count = (selector: string) => root.querySelectorAll(selector).length
        const styleNumber = (selector: string, property: string) =>
          Number.parseFloat(
            String(
              getComputedStyle(root.querySelector<HTMLElement>(selector)!).getPropertyValue(
                property
              )
            )
          )
        const headingAnchor = root.querySelector<HTMLElement>('#reading-fixture-h2 a')
        const heading = root.querySelector<HTMLElement>('#reading-fixture-h2')
        const table = root.querySelector<HTMLElement>('.article-table-scroll')
        const longToken = root.querySelector<HTMLElement>('p:last-child')
        const mark = root.querySelector<HTMLElement>('mark')
        const checked = root.querySelector<HTMLElement>('input[type="checkbox"]:checked')
        const unchecked = root.querySelector<HTMLElement>('input[type="checkbox"]:not(:checked)')
        const separator = root.querySelector<HTMLElement>('hr')
        const backref = root.querySelector<HTMLElement>('.data-footnote-backref')

        if (
          !headingAnchor ||
          !heading ||
          !table ||
          !longToken ||
          !mark ||
          !checked ||
          !unchecked ||
          !separator ||
          !backref
        ) {
          throw new Error('Missing injected reading family target')
        }

        const anchorRect = headingAnchor.getBoundingClientRect()
        const headingRect = heading.getBoundingClientRect()
        const backrefRect = backref.getBoundingClientRect()

        return {
          counts: {
            h2: count('h2'),
            h3: count('h3'),
            h4: count('h4'),
            h5: count('h5'),
            h6: count('h6'),
            p: count('p'),
            strong: count('strong'),
            em: count('em'),
            del: count('del'),
            ul: count('ul'),
            ol: count('ol'),
            task: count('.task-list-item, input[type="checkbox"]'),
            links: count('a'),
            blockquote: count('blockquote'),
            inlineCode: count(':not(pre) > code'),
            linkedCode: count('a code'),
            preCode: count('pre code'),
            table: count('table'),
            image: count('img'),
            figure: count('figure'),
            caption: count('figcaption'),
            details: count('details'),
            summary: count('summary'),
            footnotes: count('.footnotes'),
            footnoteRefs: count('sup a[href="#reading-fixture-footnote"]'),
            footnoteBackrefs: count('.data-footnote-backref'),
            kbd: count('kbd'),
            abbr: count('abbr'),
            mark: count('mark'),
            sub: count('sub'),
            sup: count('sup'),
            hr: count('hr'),
            embeds: count('[data-reading-fixture-embed]'),
          },
          headingSizes: {
            h2: styleNumber('h2', 'font-size'),
            h3: styleNumber('h3', 'font-size'),
            h4: styleNumber('h4', 'font-size'),
            h5: styleNumber('h5', 'font-size'),
            h6: styleNumber('h6', 'font-size'),
          },
          anchor: {
            left: anchorRect.left,
            right: anchorRect.right,
            width: anchorRect.width,
            height: anchorRect.height,
            headingLeft: headingRect.left,
            viewportWidth: window.innerWidth,
          },
          table: {
            clientWidth: table.clientWidth,
            scrollWidth: table.scrollWidth,
            overflowX: getComputedStyle(table).overflowX,
          },
          longToken: {
            clientWidth: longToken.clientWidth,
            scrollWidth: longToken.scrollWidth,
          },
          mark: {
            color: getComputedStyle(mark).color,
            backgroundColor: getComputedStyle(mark).backgroundColor,
          },
          checkboxes: [checked, unchecked].map((box) => {
            const rect = box.getBoundingClientRect()

            return {
              width: rect.width,
              height: rect.height,
              backgroundColor: getComputedStyle(box).backgroundColor,
            }
          }),
          footnote: {
            separatorDisplay: getComputedStyle(separator).display,
            backrefWidth: backrefRect.width,
            backrefHeight: backrefRect.height,
            backrefBackground: getComputedStyle(backref).backgroundColor,
          },
          documentOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })

      for (const [name, count] of Object.entries(metrics.counts)) {
        expect(count, `${name} ${theme} ${viewport.width}`).toBeGreaterThan(0)
      }

      expect(metrics.documentOverflow).toBeLessThanOrEqual(0)
      expect(metrics.headingSizes.h2).toBeGreaterThan(metrics.headingSizes.h3)
      expect(metrics.headingSizes.h3).toBeGreaterThan(metrics.headingSizes.h4)
      expect(metrics.headingSizes.h4).toBeGreaterThan(metrics.headingSizes.h5)
      expect(metrics.headingSizes.h5).toBeGreaterThan(metrics.headingSizes.h6)
      expect(metrics.anchor.width).toBeGreaterThanOrEqual(24)
      expect(metrics.anchor.height).toBeGreaterThanOrEqual(24)
      expect(metrics.anchor.left).toBeGreaterThanOrEqual(0)
      expect(metrics.anchor.right).toBeLessThanOrEqual(metrics.anchor.viewportWidth)
      expect(metrics.table.scrollWidth).toBeGreaterThanOrEqual(metrics.table.clientWidth)
      expect(['auto', 'scroll']).toContain(metrics.table.overflowX)
      expect(metrics.longToken.scrollWidth).toBeLessThanOrEqual(metrics.longToken.clientWidth + 1)
      expect(metrics.mark.backgroundColor).not.toBe('rgb(255, 255, 0)')
      expect(metrics.mark.backgroundColor).not.toBe('yellow')
      expect(metrics.footnote.separatorDisplay).toBe('none')
      expect(metrics.footnote.backrefWidth).toBeGreaterThanOrEqual(24)
      expect(metrics.footnote.backrefHeight).toBeGreaterThanOrEqual(24)
      expect(metrics.footnote.backrefBackground).not.toBe('rgba(0, 0, 0, 0)')

      for (const checkbox of metrics.checkboxes) {
        expect(checkbox.width).toBeGreaterThanOrEqual(16)
        expect(checkbox.height).toBeGreaterThanOrEqual(16)
        expect(checkbox.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      }
    }
  }
})

test('Reading Max rich content and 200 percent text resize stay internally scrollable', async ({
  page,
}) => {
  for (const theme of ['light', 'dark'] as const) {
    await openReadingPage(page, RICH_ARTICLE_PATH, { width: 320, height: 812 }, theme)

    const math = await scrollBoxMetrics(page, "mjx-container[jax='SVG'][display='true']")
    const code = await scrollBoxMetrics(
      page,
      'figure[data-rehype-pretty-code-figure] [data-code-pre]'
    )
    const table = await scrollBoxMetrics(page, '[data-article-body] .article-table-scroll')
    const overflow = await noPageOverflow(page)

    expect(overflow.overflowPx).toBeLessThanOrEqual(0)
    for (const item of [math, code, table]) {
      expect(item.scrollWidth).toBeGreaterThan(item.clientWidth)
      expect(['auto', 'scroll']).toContain(item.overflowX)
    }
  }

  for (const path of [ARTICLE_PATH, '/en/xiaomi-book-pro-14/', RICH_ARTICLE_PATH]) {
    await openReadingPage(page, path, { width: 640, height: 900 }, 'dark', 200)

    const rootFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
    const overflow = await noPageOverflow(page)
    const close = await scrollBoxMetrics(
      page,
      'a[aria-label="返回列表"], a[aria-label="Back to list"]'
    )
    const tocButton = page.locator('.article-toc-mobile button').first()

    expect(rootFont).toBe('32px')
    expect(overflow.overflowPx).toBeLessThanOrEqual(0)
    expect(close.rect.width).toBeGreaterThanOrEqual(44)
    expect(close.rect.height).toBeGreaterThanOrEqual(44)

    if ((await tocButton.count()) > 0) {
      const tocButtonBox = await scrollBoxMetrics(page, '.article-toc-mobile button')
      expect(tocButtonBox.rect.height).toBeGreaterThanOrEqual(44)
    }

    const inlineCode = await inlineCodeStyleMetrics(page)

    expect(inlineCode.color).not.toBe(LIGHT_INLINE_CODE_COLOR)
    expect(inlineCode.backgroundImage).toBe('none')
    expect(inlineCode.contrast).toBeGreaterThanOrEqual(4.5)

    if (path === RICH_ARTICLE_PATH) {
      for (const selector of [
        'figure[data-rehype-pretty-code-figure] [data-code-pre]',
        "mjx-container[jax='SVG'][display='true']",
        '[data-article-body] .article-table-scroll',
      ]) {
        const metrics = await scrollBoxMetrics(page, selector)

        expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
        expect(['auto', 'scroll']).toContain(metrics.overflowX)
      }
    }
  }
})

test('display MathJax is contained at 320px with internal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto(RICH_ARTICLE_PATH)

  const equation = page.locator("mjx-container[jax='SVG'][display='true']").first()
  await equation.scrollIntoViewIfNeeded()

  const metrics = await equation.evaluate((element) => {
    const body = document.querySelector<HTMLElement>('[data-article-body]')

    if (!body) {
      throw new Error('Missing article body')
    }

    const rect = element.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const style = getComputedStyle(element)

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: style.overflowX,
      left: rect.left,
      right: rect.right,
      bodyLeft: bodyRect.left,
      bodyRight: bodyRect.right,
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }
  })

  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth)
  expect(['auto', 'scroll']).toContain(metrics.overflowX)
  expect(metrics.left).toBeGreaterThanOrEqual(metrics.bodyLeft - 1)
  expect(metrics.right).toBeLessThanOrEqual(metrics.bodyRight + 1)
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test('code controls do not overlap the first code line at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto(RICH_ARTICLE_PATH)

  const figure = page.locator('figure[data-rehype-pretty-code-figure]').first()
  await figure.scrollIntoViewIfNeeded()

  const metrics = await figure.evaluate((root) => {
    const header = root.querySelector<HTMLElement>('[data-code-header]')
    const pre = root.querySelector<HTMLElement>('[data-code-pre]')
    const firstLine = root.querySelector<HTMLElement>('[data-code-line]')
    const copyButton = root.querySelector<HTMLElement>('[data-code-copy]')
    const sourceLink = root.querySelector<HTMLElement>('a[href*="github.com"]')

    if (!header || !pre || !firstLine || !copyButton) {
      throw new Error('Missing code block geometry target')
    }

    const rect = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect()

      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      }
    }
    const intersects = (first: ReturnType<typeof rect>, second: ReturnType<typeof rect>) =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top
    const firstLineRect = rect(firstLine)
    const copyRect = rect(copyButton)
    const sourceRect = sourceLink ? rect(sourceLink) : null

    return {
      header: rect(header),
      pre: rect(pre),
      firstLine: firstLineRect,
      copy: copyRect,
      source: sourceRect,
      copyIntersectsFirstLine: intersects(copyRect, firstLineRect),
      sourceIntersectsFirstLine: sourceRect ? intersects(sourceRect, firstLineRect) : false,
      preClientWidth: pre.clientWidth,
      preScrollWidth: pre.scrollWidth,
      preOverflowX: getComputedStyle(pre).overflowX,
      viewportWidth: window.innerWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
    }
  })

  expect(metrics.header.bottom).toBeLessThanOrEqual(metrics.pre.top + 1)
  expect(metrics.copyIntersectsFirstLine).toBe(false)
  expect(metrics.sourceIntersectsFirstLine).toBe(false)
  expect(metrics.copy.width).toBeGreaterThanOrEqual(44)
  expect(metrics.copy.height).toBeGreaterThanOrEqual(44)
  expect(metrics.preScrollWidth).toBeGreaterThan(metrics.preClientWidth)
  expect(['auto', 'scroll']).toContain(metrics.preOverflowX)
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test('code copy failure is announced with recovery text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('blocked')
        },
      },
    })
  })
  await page.goto(RICH_ARTICLE_PATH)

  const figure = page.locator('figure[data-rehype-pretty-code-figure]').first()
  const status = figure.locator('[role="status"]')

  await figure.getByRole('button', { name: '复制代码' }).click()
  await expect(status).toContainText('复制失败，请手动选择代码。')
  await expect(figure.getByRole('button', { name: '复制失败，请手动选择代码。' })).toBeVisible()
})

test('desktop TOC wraps long labels and heading hashes clear the fixed header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(RICH_ARTICLE_PATH)

  await expect(page.locator('.article-toc-desktop')).toBeVisible()

  const tocMetrics = await page.locator('.article-toc-desktop a span').evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item)

      return {
        text: item.textContent?.trim() || '',
        clientWidth: item.clientWidth,
        scrollWidth: item.scrollWidth,
        whiteSpace: style.whiteSpace,
      }
    })
  )

  expect(tocMetrics.length).toBeGreaterThan(0)
  for (const item of tocMetrics) {
    expect(item.whiteSpace).not.toBe('nowrap')
    expect(item.scrollWidth, item.text).toBeLessThanOrEqual(item.clientWidth + 1)
  }

  const heading = page.locator('[data-article-body] h2').first()
  const headingId = await heading.getAttribute('id')

  expect(headingId).toBeTruthy()
  await page.goto(`${RICH_ARTICLE_PATH}#${headingId}`)

  await expect
    .poll(() =>
      page.evaluate((id) => {
        const target = document.getElementById(id)
        const header = document.querySelector<HTMLElement>('body header')

        if (!target || !header) {
          throw new Error('Missing hash offset target')
        }

        return target.getBoundingClientRect().top - header.getBoundingClientRect().bottom
      }, headingId!)
    )
    .toBeGreaterThanOrEqual(8)

  const hashMetrics = await page.evaluate((id) => {
    const target = document.getElementById(id)
    const header = document.querySelector<HTMLElement>('body header')
    const anchor = target?.querySelector<HTMLElement>('a:has(.content-header-link)')

    if (!target || !header || !anchor) {
      throw new Error('Missing heading anchor target')
    }

    const targetRect = target.getBoundingClientRect()
    const headerRect = header.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()

    return {
      headingTop: targetRect.top,
      headerBottom: headerRect.bottom,
      anchorLeft: anchorRect.left,
      anchorRight: anchorRect.right,
      headingLeft: targetRect.left,
      anchorWidth: anchorRect.width,
      pageScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  }, headingId!)

  expect(hashMetrics.headingTop).toBeGreaterThanOrEqual(hashMetrics.headerBottom + 8)
  expect(hashMetrics.anchorLeft).toBeGreaterThanOrEqual(0)
  expect(hashMetrics.anchorRight).toBeLessThanOrEqual(hashMetrics.headingLeft - 0.5)
  expect(hashMetrics.anchorWidth).toBeGreaterThanOrEqual(24)
  expect(hashMetrics.pageScrollWidth).toBeLessThanOrEqual(hashMetrics.viewportWidth)
})

test('content screenshots expose meaningful image alt text', async ({ page }) => {
  await page.goto(IMAGE_ARTICLE_PATH)

  await expect(
    page.getByRole('img', { name: 'KDE 系统设置中 Obsidian 的窗口规则配置界面' })
  ).toBeVisible()
})

for (const viewport of [
  { width: 320, height: 720, top: 72, radius: 0 },
  { width: 390, height: 844, top: 72, radius: 0 },
  { width: 1440, height: 900, top: 120, radius: 8 },
] as const) {
  test(`a compact article link shows one cover-first pending surface at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    let releaseArticleRequest!: () => void
    let delayedArticleRequests = 0
    const articleRequestReleased = new Promise<void>((resolve) => {
      releaseArticleRequest = resolve
    })

    await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
      delayedArticleRequests += 1
      await articleRequestReleased
      await route.continue()
    })

    await page.goto('/zh/')

    const compactLink = page.locator(
      `.blog-sidebar-right a[data-blog-post-link][href="${ARTICLE_PATH}"]`
    )
    await expect(compactLink).toHaveCount(1)
    await compactLink.scrollIntoViewIfNeeded()

    const clickPromise = compactLink.click()
    const skeleton = page.locator('[data-article-route-skeleton]')

    try {
      await expect.poll(() => delayedArticleRequests).toBeGreaterThan(0)
      await expect(skeleton).toHaveCount(1)
      await expect(skeleton).toBeVisible()
      await expect(skeleton).toHaveAttribute('aria-hidden', 'true')

      const geometry = await skeleton.evaluate((root) => {
        const rect = (selector: string) => {
          const element = root.querySelector<HTMLElement>(selector)

          if (!element) throw new Error(`Missing pending article ${selector}`)

          const bounds = element.getBoundingClientRect()
          return {
            top: bounds.top,
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height,
          }
        }

        const surface = root.querySelector<HTMLElement>('[data-article-skeleton-surface]')
        const mobileToc = root.querySelector<HTMLElement>('[data-article-skeleton-mobile-toc]')
        const desktopToc = root.querySelector<HTMLElement>('[data-article-skeleton-desktop-toc]')

        if (!surface || !mobileToc || !desktopToc) {
          throw new Error('Missing pending article surface geometry target')
        }

        return {
          surface: rect('[data-article-skeleton-surface]'),
          cover: rect('[data-article-skeleton-cover]'),
          body: rect('[data-article-skeleton-body]'),
          radius: Number.parseFloat(getComputedStyle(surface).borderTopLeftRadius),
          background: getComputedStyle(surface).backgroundColor,
          mobileToc:
            getComputedStyle(mobileToc).display === 'none'
              ? null
              : rect('[data-article-skeleton-mobile-toc]'),
          desktopToc:
            getComputedStyle(desktopToc).display === 'none'
              ? null
              : {
                  ...rect('[data-article-skeleton-desktop-toc]'),
                  position: getComputedStyle(desktopToc).position,
                  opacity: Number.parseFloat(getComputedStyle(desktopToc).opacity),
                },
          surfaceCount: root.querySelectorAll('[data-article-skeleton-surface]').length,
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }
      })

      const expectedWidth = articleSurfaceWidth(viewport.width)
      const expectedLeft = destination(viewport.width, viewport.height).left

      expect(geometry.surfaceCount).toBe(1)
      expect(Math.abs(geometry.surface.top - viewport.top)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.surface.left - expectedLeft)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.surface.width - expectedWidth)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.radius - viewport.radius)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.top - geometry.surface.top)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.left - geometry.surface.left)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.right - geometry.surface.right)).toBeLessThanOrEqual(0.5)
      expect(
        Math.abs(geometry.cover.height - articleCoverHeight(geometry.cover.width))
      ).toBeLessThan(4)
      expect(geometry.cover.bottom).toBeLessThan(geometry.body.top)
      expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(geometry.surface.right).toBeLessThanOrEqual(geometry.viewportWidth + 0.5)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth)

      if (viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
        expect(geometry.mobileToc).toBeNull()
        expect(geometry.desktopToc).not.toBeNull()
        expect(
          Math.abs(geometry.desktopToc!.width - ARTICLE_DESKTOP_TOC_WIDTH)
        ).toBeLessThanOrEqual(1)
        expect(geometry.surface.left - geometry.desktopToc!.right).toBeGreaterThanOrEqual(
          ARTICLE_DESKTOP_TOC_GAP - 1
        )
        expect(geometry.surface.left - geometry.desktopToc!.right).toBeLessThanOrEqual(
          ARTICLE_DESKTOP_TOC_GAP + 1
        )
        expect(
          Math.abs(geometry.desktopToc!.left - articleShellLeft(viewport.width))
        ).toBeLessThanOrEqual(1)
        expect(geometry.desktopToc!.position).toBe('sticky')
        expect(geometry.desktopToc!.opacity).toBe(1)
      } else {
        expect(geometry.desktopToc).toBeNull()
        expect(geometry.mobileToc).not.toBeNull()
        expect(geometry.mobileToc!.top).toBeGreaterThan(geometry.cover.bottom)
        expect(geometry.mobileToc!.bottom).toBeLessThanOrEqual(geometry.body.top)
      }
    } finally {
      releaseArticleRequest()
      await clickPromise
    }

    await expect(page).toHaveURL(ARTICLE_PATH)
    await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
  })
}

test('the static list payload excludes article MDX while the article payload includes it', async ({
  request,
}) => {
  const [listResponse, articleResponse] = await Promise.all([
    request.get('/zh/'),
    request.get(ARTICLE_PATH),
  ])

  expect(listResponse.ok()).toBe(true)
  expect(articleResponse.ok()).toBe(true)
  expect(await listResponse.text()).not.toContain(BODY_TEXT)
  expect(await articleResponse.text()).toContain(BODY_TEXT)
})

test('reading progress completes at the article end before the footer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(ARTICLE_PATH)

  const reader = page.locator('[data-article-reader]')
  const progress = page.locator('[data-reading-progress]')

  await reader.evaluate((element) => {
    const bottom = element.getBoundingClientRect().bottom + window.scrollY
    window.scrollTo(0, bottom - window.innerHeight)
  })

  await expect
    .poll(() =>
      progress.evaluate((element) => {
        const transform = getComputedStyle(element).transform

        if (transform === 'none') {
          return 1
        }

        return Number.parseFloat(transform.split('(')[1]?.split(',')[0] || '0')
      })
    )
    .toBeGreaterThanOrEqual(0.99)

  await expect(page.locator('footer')).not.toBeInViewport()
})

test('the article return control uses native Back for repeated visits from the same list', async ({
  page,
}) => {
  const firstScrollY = await openArticleFromCategory(page, 'read-more', true)

  await expect
    .poll(() =>
      page.evaluate((key) => window.sessionStorage.getItem(key), ARTICLE_RETURN_MARKER_KEY)
    )
    .toBeNull()

  await returnLink(page).click()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScrollY(page, firstScrollY)

  const link = articleEntryLink(page, 'read-more')
  await link.scrollIntoViewIfNeeded()
  const secondScrollY = await page.evaluate(() => window.scrollY)

  expect(secondScrollY).toBeGreaterThan(0)
  await link.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
  await expect
    .poll(() =>
      page.evaluate((key) => window.sessionStorage.getItem(key), ARTICLE_RETURN_MARKER_KEY)
    )
    .toBeNull()

  await returnLink(page).click()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScrollY(page, secondScrollY)
})

test('an article fragment does not displace the proven list history entry', async ({ page }) => {
  const previousScrollY = await openArticleFromCategory(page)

  await expect
    .poll(() =>
      page.evaluate((key) => window.sessionStorage.getItem(key), ARTICLE_RETURN_MARKER_KEY)
    )
    .toBeNull()

  const mobileTocButton = page.getByRole('button', { name: '目录' })

  if (await mobileTocButton.isVisible()) {
    await mobileTocButton.click()
  }

  const tocLink = page.locator('nav[aria-label="目录"]:visible a').first()
  const fragment = await tocLink.getAttribute('href')
  const historyBefore = await page.evaluate(() => ({
    length: window.history.length,
    state: JSON.stringify(window.history.state),
  }))

  expect(fragment).toMatch(/^#./)
  await tocLink.click()
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(window.location.hash)))
    .toBe(fragment)
  await expect(page.locator(fragment!)).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.history.length)).toBe(historyBefore.length)
  expect(await page.evaluate(() => JSON.stringify(window.history.state))).toBe(historyBefore.state)

  await returnLink(page).click()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScrollY(page, previousScrollY)
})

test('adjacent article navigation does not reuse list return provenance', async ({ page }) => {
  await openArticleFromCategory(page)
  const adjacentLink = page.locator('.article-post-nav a').first()
  const adjacentHref = await adjacentLink.getAttribute('href')

  expect(adjacentHref).toBeTruthy()
  expect(adjacentHref).not.toBe(ARTICLE_PATH)
  await adjacentLink.click()
  await expect(page).toHaveURL(adjacentHref!)

  await returnLink(page).click()
  await expect(page).toHaveURL('/zh/')
})

test('single adjacent article navigation uses the full mobile rail', async ({ page }) => {
  await openReadingPage(page, ARTICLE_PATH, { width: 320, height: 812 }, 'dark')

  const nav = page.locator('.article-post-nav')
  await nav.scrollIntoViewIfNeeded()
  await expect(nav.locator('a')).toHaveCount(1)

  const metrics = await nav.evaluate((root) => {
    const link = root.querySelector<HTMLElement>('a')
    const emptyColumns = root.querySelectorAll(':scope > div').length

    if (!link) {
      throw new Error('Missing adjacent article link')
    }

    const navRect = root.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    const title = link.querySelector<HTMLElement>('span:last-child')
    const titleRect = title?.getBoundingClientRect()

    return {
      childCount: root.children.length,
      emptyColumns,
      nav: {
        left: navRect.left,
        right: navRect.right,
        width: navRect.width,
      },
      link: {
        left: linkRect.left,
        right: linkRect.right,
        width: linkRect.width,
      },
      titleWidth: titleRect?.width ?? 0,
    }
  })

  expect(metrics.childCount).toBe(1)
  expect(metrics.emptyColumns).toBe(0)
  expect(Math.abs(metrics.link.left - metrics.nav.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(metrics.link.right - metrics.nav.right)).toBeLessThanOrEqual(1)
  expect(metrics.link.width).toBeGreaterThanOrEqual(metrics.nav.width - 1)
  expect(metrics.titleWidth).toBeGreaterThanOrEqual(metrics.nav.width - 1)
})

test('browser Back restores the list with native scroll restoration', async ({ page }) => {
  const previousScrollY = await openArticleFromCategory(page)

  await page.goBack()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScrollY(page, previousScrollY)
})

test('direct entry ignores unrelated browser history', async ({ page }) => {
  await page.goto('/zh/tags/')
  await page.goto(ARTICLE_PATH)

  await returnLink(page).click()
  await expect(page).toHaveURL('/zh/')
})

test('refresh invalidates a previously recorded list source', async ({ page }) => {
  await openArticleFromCategory(page)
  await page.reload()
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)

  await returnLink(page).click()
  await expect(page).toHaveURL('/zh/')
})

test('a modified article click opens an independent tab without a return marker or transition UI', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Modified-click semantics are covered on desktop')

  await page.goto(SOURCE_PATH)
  const link = transitionEntryLink(page, 'read-more')
  await link.scrollIntoViewIfNeeded()

  const popupPromise = page.context().waitForEvent('page')
  await link.click({ modifiers: ['ControlOrMeta'] })
  const popup = await popupPromise

  await expect(page).toHaveURL(SOURCE_PATH)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-article-transition-fallback]')).toHaveCount(0)
  await expect(popup).toHaveURL(ARTICLE_PATH)
  await expect(popup.locator('[data-article-body]')).toContainText(BODY_TEXT)
  await expect(
    popup.evaluate((key) => window.sessionStorage.getItem(key), ARTICLE_RETURN_MARKER_KEY)
  ).resolves.toBeNull()

  await returnLink(popup).click()
  await expect(popup).toHaveURL('/zh/')
})

for (const reducedMotion of [false, true]) {
  test(`article body is never gated by route animation${
    reducedMotion ? ' with reduced motion' : ''
  }`, async ({ page }) => {
    if (reducedMotion) {
      await page.emulateMedia({ reducedMotion: 'reduce' })
    }

    await page.goto(SOURCE_PATH)
    await page.evaluate(() => {
      const probe = {
        badProperties: [] as string[],
        done: false,
        minHeight: Number.POSITIVE_INFINITY,
        minOpacity: 1,
        samples: 0,
      }
      ;(window as Window & { __articleBodyProbe?: typeof probe }).__articleBodyProbe = probe

      let firstBodyFrame = 0
      const sample = (now: number) => {
        const body = document.querySelector<HTMLElement>('[data-article-body]')

        if (!body) {
          window.requestAnimationFrame(sample)
          return
        }

        if (firstBodyFrame === 0) {
          firstBodyFrame = now
        }

        const tracked: HTMLElement[] = []
        let current: HTMLElement | null = body

        while (current) {
          tracked.push(current)
          if (current.tagName === 'MAIN') break
          current = current.parentElement
        }

        probe.samples += 1
        probe.minHeight = Math.min(probe.minHeight, body.getBoundingClientRect().height)
        probe.minOpacity = Math.min(
          probe.minOpacity,
          ...tracked.map((element) => Number.parseFloat(getComputedStyle(element).opacity))
        )

        for (const element of tracked) {
          for (const animation of element.getAnimations()) {
            const effect = animation.effect
            if (!(effect instanceof KeyframeEffect)) continue

            for (const frame of effect.getKeyframes()) {
              for (const property of ['height', 'maxHeight', 'opacity']) {
                if (property in frame && !probe.badProperties.includes(property)) {
                  probe.badProperties.push(property)
                }
              }
            }
          }
        }

        if (now - firstBodyFrame >= 300) {
          probe.done = true
          return
        }

        window.requestAnimationFrame(sample)
      }

      window.requestAnimationFrame(sample)
    })

    await articleEntryLink(page, 'read-more').click()
    await expect(page).toHaveURL(ARTICLE_PATH)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __articleBodyProbe?: { done: boolean } }).__articleBodyProbe?.done
        )
      )
      .toBe(true)

    const probe = await page.evaluate(
      () =>
        (
          window as Window & {
            __articleBodyProbe?: {
              badProperties: string[]
              minHeight: number
              minOpacity: number
              samples: number
            }
          }
        ).__articleBodyProbe
    )

    expect(probe?.samples).toBeGreaterThan(1)
    expect(probe?.minHeight).toBeGreaterThan(0)
    expect(probe?.minOpacity).toBe(1)
    expect(probe?.badProperties).toEqual([])
  })
}

test('related commits remain a bounded disclosure on the article page', async ({ page }) => {
  await page.goto(ARTICLE_PATH)

  const article = page.locator('article[data-article-reader]')
  const details = article.locator('details').filter({ hasText: '文章信息' })
  await expect(details.locator('summary')).toBeVisible()
  await expect(article.locator('a[href*="/commit/"]')).toHaveCount(0)

  await details.locator('summary').click()

  const commitsButton = article.getByRole('button', { name: /相关提交/ })
  await expect(commitsButton).toHaveAttribute('aria-expanded', 'false')

  const panelId = await commitsButton.getAttribute('aria-controls')
  expect(panelId).toBeTruthy()
  await expect(article.locator('a[href*="/commit/"]')).toHaveCount(0)

  await commitsButton.click()
  await expect(commitsButton).toHaveAttribute('aria-expanded', 'true')
  await expect(article.locator(`[id="${panelId}"]`)).toBeVisible()
  await expect(article.locator('a[href*="/commit/"]').first()).toBeVisible()
})

// ---------- 卡片转场 ----------

for (const scenario of [
  { viewport: { width: 320, height: 720 }, entry: 'cover' as const, theme: 'light' as const },
  { viewport: { width: 390, height: 844 }, entry: 'title' as const, theme: 'dark' as const },
  {
    viewport: { width: 1440, height: 900 },
    entry: 'read-more' as const,
    theme: 'light' as const,
  },
]) {
  test(`${scenario.entry} expands one card snapshot at ${scenario.viewport.width}x${scenario.viewport.height} in ${scenario.theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((theme) => localStorage.setItem('theme', theme), scenario.theme)
    const result = await openCard(page, scenario.viewport, scenario.entry)
    const target = destination(scenario.viewport.width, scenario.viewport.height)
    const frames = result.probe.frames.filter((frame) => frame.phase === 'opening')

    expect(frames.length).toBeGreaterThan(3)
    expectRectNear(frames[0], result.source)
    expectRectNear(frames[0].cover, result.sourceCover)
    for (const marker of CARD_PRESENTATION_MARKERS) {
      expect(frames[0].items[marker], `missing initial overlay item: ${marker}`).toBeDefined()
      expectRectNear(frames[0].items[marker], result.sourceItems[marker], 0.5)
    }
    expectRectNear(frames.at(-1)!, target)
    expectRectNear(frames.at(-1)!.cover, {
      top: target.top,
      left: target.left,
      width: target.width,
      height: articleCoverHeight(target.width),
    })

    const middle = frames.reduce((closest, frame) =>
      Math.abs(frame.time - 190) < Math.abs(closest.time - 190) ? frame : closest
    )
    expectWithin(middle.top, result.source.top, target.top)
    expectWithin(middle.left, result.source.left, target.left)
    expectWithin(middle.width, result.source.width, target.width)
    expectWithin(middle.height, result.source.height, target.height)

    expect(result.probe.maxOverlayCount).toBe(1)
    expect(result.probe.removedAt).toBeLessThanOrEqual(500)
    expect(result.probe.ariaHidden).toBe('true')
    expect(result.probe.pointerEvents).toBe('none')
    expect(result.probe.position).toBe('fixed')
    expect(result.probe.overlayZ).toBe(40)
    expect(result.probe.headerZ).toBe(50)
    expect(result.probe.coverObjectFit).toBe('cover')
    expect(result.probe.snapshotText).toContain('继续阅读')
    expect(result.probe.snapshotText).toContain('更新于')
    expect(result.probe.snapshotText).toContain('查看源文')
    expect(result.probe.snapshotText).toContain('Linux')
    for (const frame of frames) {
      expect(frame.languageIndicator.present).toBe(true)
      expect(frame.languageIndicator.opacity).toBe(1)
      expect(frame.languageIndicator.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(frame.languageIndicator.bounded).toBe(true)
      expect(frame.languageIndicator.visibleAtCenter).toBe(true)
      expect(frame.languageIndicator.animationCount).toBe(0)
      expect(frame.languageIndicator.width).toBeGreaterThan(0)
      expect(frame.languageIndicator.height).toBeGreaterThan(0)
    }

    const destinationOpeningFrames = frames.filter((frame) => frame.destinationStage === 'opening')
    expect(destinationOpeningFrames.length).toBeGreaterThan(0)
    for (const frame of destinationOpeningFrames) {
      expect(frame.underlayPresent).toBe(true)
      expect(frame.underlayOpaque).toBe(true)
      expect(frame.destinationOnlyOpacities.length).toBeGreaterThan(0)
      expect(frame.destinationOnlyOpacities.every((opacity) => opacity === 0)).toBe(true)
      expect(frame.sharedDestinationOpacities.length).toBeGreaterThan(0)
      expect(frame.sharedDestinationOpacities.every((opacity) => opacity === 1)).toBe(true)
      expect(frame.coverPointOwnership.pointInViewport).toBe(true)
      expect(frame.returnControlPointOwnership.pointInViewport).toBe(true)
      expect(frame.overlayOwnsCoverPoint, JSON.stringify(frame.coverPointOwnership)).toBe(true)
      expect(
        frame.overlayOwnsReturnControlPoint,
        JSON.stringify(frame.returnControlPointOwnership)
      ).toBe(true)
    }

    const finalFrame = frames.at(-1)!
    for (const marker of ['title', 'git-updated', 'git-source', 'summary', 'date', 'primary-tag']) {
      const overlayItem = finalFrame.items[marker]
      const articleItem = await presentationItem(page, marker)

      expect(overlayItem, `missing overlay presentation item: ${marker}`).toBeDefined()
      expect(overlayItem.text).toBe(articleItem.text)
      expect(overlayItem.opacity).toBe(1)
      expect({
        fontFamily: overlayItem.fontFamily,
        fontSize: overlayItem.fontSize,
        fontWeight: overlayItem.fontWeight,
        lineHeight: overlayItem.lineHeight,
        letterSpacing: overlayItem.letterSpacing,
      }).toEqual({
        fontFamily: articleItem.fontFamily,
        fontSize: articleItem.fontSize,
        fontWeight: articleItem.fontWeight,
        lineHeight: articleItem.lineHeight,
        letterSpacing: articleItem.letterSpacing,
      })
      expectRectNear(overlayItem, articleItem, 5)
    }

    expect(frames[0].items['read-more']).toBeDefined()
    expect(frames[0].items['read-more'].opacity).toBeGreaterThan(0.7)
    expect(finalFrame.items['read-more'].text).toBe('继续阅读')
    expect(finalFrame.items['read-more'].opacity).toBeLessThan(0.2)
    expect(
      frames.some((frame) => {
        const opacity = frame.items['read-more']?.opacity

        return opacity > 0.1 && opacity < 0.9
      })
    ).toBe(true)
    expect(frames.some((frame) => frame.transform !== 'none')).toBe(true)
    expect(result.probe.animatedProperties).not.toEqual(
      expect.arrayContaining(['top', 'left', 'width', 'height'])
    )
    expect(result.body.height).toBeGreaterThan(0)
    expect(result.body.opacity).toBe(1)
    expect(await page.locator('[data-article-transition-fallback]').count()).toBe(0)
    expect(await page.locator('[data-article-transition-overlay]').count()).toBe(0)
    await expect
      .poll(async () => {
        const opacities = await page
          .locator('main [data-article-transition-destination-only]')
          .evaluateAll((elements) =>
            elements.map((element) => Number.parseFloat(getComputedStyle(element).opacity))
          )

        return opacities.length > 0 && opacities.every((opacity) => opacity === 1)
      })
      .toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      scenario.viewport.width
    )
  })
}

test('a slow target commit preserves the concealed opening barrier before reveal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })

  let releaseRequest!: () => void
  let delayedRequests = 0
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
    delayedRequests += 1
    await released
    await route.continue()
  })

  await page.goto(SOURCE_PATH)
  const link = transitionEntryLink(page, 'title')
  await link.scrollIntoViewIfNeeded()
  await installTransitionProbe(page)
  const click = link.click()

  try {
    await expect.poll(() => delayedRequests).toBeGreaterThan(0)
    await page.waitForTimeout(450)

    const precommit = await readProbe(page)

    if (!precommit) {
      throw new Error('Missing slow-route transition probe')
    }

    expect(precommit.frames.length).toBeGreaterThan(3)
    expect(precommit.frames.every((frame) => frame.destinationStage === '')).toBe(true)
    expect(precommit.frames.every((frame) => !frame.underlayPresent)).toBe(true)
  } finally {
    releaseRequest()
    await click
  }

  await expect(page).toHaveURL(ARTICLE_PATH)
  const probe = await waitForProbeRemoval(page)
  const firstTargetFrames = probe.frames.filter(
    (frame) => frame.destinationStage === 'opening' && frame.destinationOnlyOpacities.length > 0
  )

  expect(firstTargetFrames.length).toBeGreaterThan(0)
  expect(firstTargetFrames.every((frame) => frame.underlayPresent && frame.underlayOpaque)).toBe(
    true
  )
  expect(
    firstTargetFrames.every((frame) =>
      frame.destinationOnlyOpacities.every((opacity) => opacity === 0)
    )
  ).toBe(true)
  await expect
    .poll(async () => {
      const opacities = await page
        .locator('main [data-article-transition-destination-only]')
        .evaluateAll((elements) =>
          elements.map((element) => Number.parseFloat(getComputedStyle(element).opacity))
        )

      return opacities.length > 0 && opacities.every((opacity) => opacity === 1)
    })
    .toBe(true)
})

for (const scenario of [
  { mode: 'return link' as const, viewport: { width: 390, height: 844 } },
  { mode: 'browser Back' as const, viewport: { width: 1440, height: 900 } },
]) {
  test(`${scenario.mode} settles the article surface into the restored card`, async ({ page }) => {
    const opened = await openCard(page, scenario.viewport, 'read-more')
    await installTransitionProbe(page)

    if (scenario.mode === 'return link') {
      await returnLink(page).click()
    } else {
      await page.goBack()
    }

    await expect(page).toHaveURL(SOURCE_PATH)
    await expectRestoredScrollY(page, opened.sourceScrollY)

    const probe = await waitForProbeRemoval(page)
    const frames = probe.frames

    expect(frames[0].phase).toBe('return-waiting')
    expectRectNear(frames[0], destination(scenario.viewport.width, scenario.viewport.height))
    expectRectNear(frames.at(-1)!, opened.source)
    expectRectNear(frames.at(-1)!.cover, opened.sourceCover)
    expect(frames.some((frame) => frame.phase === 'returning')).toBe(true)
    expect(frames[0].items['read-more'].opacity).toBeLessThan(0.2)
    expect(frames.at(-1)!.items['read-more'].opacity).toBeGreaterThan(0.8)
    expect(
      frames.some((frame) => {
        const opacity = frame.items['read-more']?.opacity

        return opacity > 0.1 && opacity < 0.9
      })
    ).toBe(true)
    expect(probe.maxOverlayCount).toBe(1)
    expect(probe.removedAt).toBeLessThanOrEqual(500)
    expect(probe.frames.every((frame) => !frame.underlayPresent)).toBe(true)
  })
}

test('reduced motion uses only a bounded destination opacity hint', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const viewport = { width: 390, height: 844 }
  const result = await openCard(page, viewport, 'read-more')
  const target = destination(viewport.width, viewport.height)

  expect(result.probe.frames.length).toBeGreaterThan(0)
  for (const frame of result.probe.frames) {
    expectRectNear(frame, target, 0.5)
    expect(frame.transform).toBe('none')
    expect(frame.underlayPresent).toBe(false)
    expect(frame.destinationStage).toBe('')
    expect(frame.destinationOnlyOpacities.every((opacity) => opacity === 1)).toBe(true)
  }
  expect(result.probe.animatedProperties).not.toEqual(
    expect.arrayContaining(['transform', 'translate', 'scale', 'top', 'left', 'width', 'height'])
  )
  expect(result.probe.removedAt).toBeLessThanOrEqual(250)
})

test('a compact search result keeps the destination skeleton fallback', async ({ page }) => {
  await page.goto('/zh/search/')

  let releaseRequest!: () => void
  let delayedRequests = 0
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
    delayedRequests += 1
    await released
    await route.continue()
  })

  await page.getByRole('searchbox', { name: '搜索' }).fill('小米')

  const result = page.locator(`a[data-blog-post-link][href="${ARTICLE_PATH}"]`)
  await expect(result).toBeVisible()
  const click = result.click()

  try {
    await expect.poll(() => delayedRequests).toBeGreaterThan(0)
    await expect(page.locator('[data-article-transition-fallback]')).toBeVisible()
    await expect(page.locator('[data-article-route-skeleton]')).toBeVisible()
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(page.locator('[data-article-transition-underlay]')).toHaveCount(0)
  } finally {
    releaseRequest()
    await click
  }

  await expect(page).toHaveURL(ARTICLE_PATH)
})

for (const failure of ['invalid full-card geometry', 'session storage failure'] as const) {
  test(`${failure} keeps full-card navigation visual-free`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    if (failure === 'session storage failure') {
      await page.addInitScript((markerKey) => {
        const setItem = Storage.prototype.setItem

        Storage.prototype.setItem = function (key, value) {
          if (key === markerKey) {
            throw new DOMException('Storage blocked for test', 'SecurityError')
          }

          return setItem.call(this, key, value)
        }
      }, ARTICLE_RETURN_MARKER_KEY)
    }

    let releaseRequest!: () => void
    let delayedRequests = 0
    const released = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
      delayedRequests += 1
      await released
      await route.continue()
    })

    await page.goto(SOURCE_PATH)
    const link = transitionEntryLink(page, 'title')
    await link.scrollIntoViewIfNeeded()

    if (failure === 'invalid full-card geometry') {
      await page.evaluate((key) => {
        const root = Array.from(
          document.querySelectorAll<HTMLElement>('[data-article-transition-card]')
        ).find((candidate) => candidate.dataset.articleTransitionKey === key)
        const cover = root?.querySelector<HTMLElement>('[data-article-transition-cover]')

        if (!cover) {
          throw new Error('Missing transition cover')
        }

        Object.defineProperty(cover, 'getBoundingClientRect', {
          configurable: true,
          value: () => new DOMRect(0, 0, 0, 0),
        })
      }, CARD_KEY)
    }

    const click = link.click()

    try {
      await expect.poll(() => delayedRequests).toBeGreaterThan(0)
      await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
      await expect(page.locator('[data-article-transition-fallback]')).toHaveCount(0)
      await expect(page.locator('[data-article-transition-underlay]')).toHaveCount(0)
    } finally {
      releaseRequest()
      await click
    }

    await expect(page).toHaveURL(ARTICLE_PATH)
    await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
  })
}

test('viewport resize cancels a pending card snapshot without delaying navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(SOURCE_PATH)
  const link = transitionEntryLink(page, 'read-more')
  await link.scrollIntoViewIfNeeded()

  let releaseRequest!: () => void
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
    await released
    await route.continue()
  })

  const click = link.click()

  try {
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(1)
    await page.setViewportSize({ width: 391, height: 844 })
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(page.locator('[data-article-transition-underlay]')).toHaveCount(0)
  } finally {
    releaseRequest()
    await click
  }

  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
})

test('a missing restored card cancels return without manufacturing a target', async ({ page }) => {
  const opened = await openCard(page, { width: 390, height: 844 }, 'read-more')
  await installTransitionProbe(page)
  await page.evaluate((key) => {
    const removeTarget = () => {
      const target = Array.from(
        document.querySelectorAll<HTMLElement>('[data-article-transition-card]')
      ).find((candidate) => candidate.dataset.articleTransitionKey === key)

      target?.remove()
    }
    const observer = new MutationObserver(removeTarget)

    observer.observe(document.body, { childList: true, subtree: true })
    ;(window as Window & { __missingTargetObserver?: MutationObserver }).__missingTargetObserver =
      observer
  }, CARD_KEY)

  await returnLink(page).click()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScrollY(page, opened.sourceScrollY)

  const probe = await waitForProbeRemoval(page)
  expect(probe.frames.every((frame) => frame.phase === 'return-waiting')).toBe(true)
  expect(await card(page).count()).toBe(0)
})

test('browser Back from a scrolled article does not mount an offscreen return snapshot', async ({
  page,
}) => {
  await openCard(page, { width: 390, height: 844 }, 'read-more')
  await page.locator('[data-article-body] h2').last().scrollIntoViewIfNeeded()
  await expect(page.locator('[data-article-cover]')).not.toBeInViewport()

  await page.goBack()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
})

// ---------- 禁用 JavaScript ----------

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('article title, body, and home fallback remain usable without any transition layer', async ({
    page,
  }) => {
    const response = await page.goto(ARTICLE_PATH)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(returnLink(page)).toHaveAttribute('href', '/zh/')

    await returnLink(page).click()
    await expect(page).toHaveURL('/zh/')
  })
})
