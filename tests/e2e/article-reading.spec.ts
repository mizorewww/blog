import { expect, test, type Locator, type Page } from '@playwright/test'

const ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'
const SOURCE_PATH = '/zh/categories/%E6%8A%98%E8%85%BE/'
const CARD_KEY = 'zh/xiaomi-book-pro-14'
const TITLE = '小米Book Pro 14 Linux使用体验'
const BODY_TEXT = '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
const RETURN_LABEL = '返回列表'
const ARTICLE_RETURN_MARKER_KEY = 'mizore:article-return'
const scrollTolerance = 10
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
  const top = mobile ? 72 : 120
  const surfaceWidth = mobile ? width : Math.min(780, width - 30)

  return {
    top,
    left: (width - surfaceWidth) / 2,
    width: surfaceWidth,
    height: height - top,
    radius: mobile ? 0 : 8,
  }
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
      const languageIndicator = document.querySelector<HTMLElement>(
        '[data-animata-language-switcher-active]'
      )
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
            }
          : null,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })

    const expectedWidth = viewport.width < 640 ? viewport.width : 780
    const expectedLeft = (viewport.width - expectedWidth) / 2

    expect(Math.abs(geometry.surface.top - viewport.top)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.surface.left - expectedLeft)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.surface.width - expectedWidth)).toBeLessThanOrEqual(4)
    expect(Math.abs(geometry.radius - viewport.radius)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.close.width - 44)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.close.height - 44)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(geometry.cover.width / geometry.cover.height - 16 / 9)).toBeLessThan(0.02)
    expect(geometry.cover.top).toBeLessThan(geometry.title.top)
    expect(geometry.cover.right).toBeLessThanOrEqual(geometry.surface.right + 0.5)
    expect(geometry.bodyHeight).toBeGreaterThan(0)
    expect(geometry.bodyOpacity).toBe(1)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.headerZ).toBe(50)
    expect(geometry.surfaceZ).toBeLessThan(geometry.headerZ)

    await expect(close).toHaveAttribute('href', '/zh/')

    if (viewport.width >= 1280) {
      await expect(page.locator('.article-toc-desktop')).toBeVisible()
      await expect(surface.locator('.article-toc-desktop')).toHaveCount(0)
      expect(geometry.desktopToc).not.toBeNull()
      expect(geometry.desktopToc!.left).toBeGreaterThanOrEqual(geometry.surface.right + 32)
      expect(geometry.desktopToc!.right).toBeLessThanOrEqual(geometry.viewportWidth - 14)
    } else {
      await expect(page.locator('.article-toc-mobile')).toBeVisible()
      await expect(surface.locator('.article-toc-mobile')).toHaveCount(1)
      expect(geometry.mobileToc).not.toBeNull()
      expect(geometry.mobileToc!.top).toBeGreaterThan(geometry.title.top)
      expect(geometry.mobileToc!.bottom).toBeLessThanOrEqual(geometry.body.top)
    }
  })
}

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
              : rect('[data-article-skeleton-desktop-toc]'),
          surfaceCount: root.querySelectorAll('[data-article-skeleton-surface]').length,
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }
      })

      const expectedWidth = viewport.width < 640 ? viewport.width : 780
      const expectedLeft = (viewport.width - expectedWidth) / 2

      expect(geometry.surfaceCount).toBe(1)
      expect(Math.abs(geometry.surface.top - viewport.top)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.surface.left - expectedLeft)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.surface.width - expectedWidth)).toBeLessThanOrEqual(4)
      expect(Math.abs(geometry.radius - viewport.radius)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.top - geometry.surface.top)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.left - geometry.surface.left)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.right - geometry.surface.right)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(geometry.cover.width / geometry.cover.height - 16 / 9)).toBeLessThan(0.02)
      expect(geometry.cover.bottom).toBeLessThan(geometry.body.top)
      expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(geometry.surface.right).toBeLessThanOrEqual(geometry.viewportWidth + 0.5)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth)

      if (viewport.width >= 1280) {
        expect(geometry.mobileToc).toBeNull()
        expect(geometry.desktopToc).not.toBeNull()
        expect(geometry.desktopToc!.left).toBeGreaterThanOrEqual(geometry.surface.right + 32)
        expect(geometry.desktopToc!.right).toBeLessThanOrEqual(geometry.viewportWidth - 14)
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
      height: (target.width * 9) / 16,
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
