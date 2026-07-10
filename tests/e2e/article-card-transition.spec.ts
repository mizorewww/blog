import { expect, test, type Locator, type Page } from '@playwright/test'

const ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'
const SOURCE_PATH = '/zh/categories/%E6%8A%98%E8%85%BE/'
const CARD_KEY = 'zh/xiaomi-book-pro-14'
const BODY_TEXT = '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
const RETURN_LABEL = '返回列表'
const ARTICLE_RETURN_MARKER_KEY = 'mizore:article-return'

type Rect = { top: number; left: number; width: number; height: number }
type TransitionFrame = Rect & {
  time: number
  phase: string
  transform: string
  overlayCount: number
  cover: Rect
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

function card(page: Page) {
  return page.locator(`[data-article-transition-key="${CARD_KEY}"]`)
}

function entryLink(page: Page, entry: 'cover' | 'title' | 'read-more') {
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
      const overlayCount = document.querySelectorAll('[data-article-transition-overlay]').length

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
  entry: 'cover' | 'title' | 'read-more'
) {
  await page.setViewportSize(viewport)
  await page.goto(SOURCE_PATH)

  const root = card(page)
  const link = entryLink(page, entry)
  await link.scrollIntoViewIfNeeded()

  const source = await elementRect(root)
  const sourceCover = await elementRect(root.locator('[data-article-transition-cover]'))
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

  return { source, sourceCover, sourceScrollY, body, probe }
}

async function expectRestoredScroll(page: Page, expected: number) {
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - expected), {
      timeout: 3_000,
    })
    .toBeLessThanOrEqual(10)
}

for (const scenario of [
  { viewport: { width: 320, height: 720 }, entry: 'cover' as const },
  { viewport: { width: 390, height: 844 }, entry: 'title' as const },
  { viewport: { width: 1440, height: 900 }, entry: 'read-more' as const },
]) {
  test(`${scenario.entry} expands one card snapshot at ${scenario.viewport.width}x${scenario.viewport.height}`, async ({
    page,
  }) => {
    const result = await openCard(page, scenario.viewport, scenario.entry)
    const target = destination(scenario.viewport.width, scenario.viewport.height)
    const frames = result.probe.frames.filter((frame) => frame.phase === 'opening')

    expect(frames.length).toBeGreaterThan(3)
    expectRectNear(frames[0], result.source)
    expectRectNear(frames[0].cover, result.sourceCover)
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
    expect(result.probe.snapshotText).not.toContain('继续阅读')
    expect(frames.some((frame) => frame.transform !== 'none')).toBe(true)
    expect(result.probe.animatedProperties).not.toEqual(
      expect.arrayContaining(['top', 'left', 'width', 'height'])
    )
    expect(result.body.height).toBeGreaterThan(0)
    expect(result.body.opacity).toBe(1)
    expect(await page.locator('[data-article-transition-fallback]').count()).toBe(0)
    expect(await page.locator('[data-article-transition-overlay]').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      scenario.viewport.width
    )
  })
}

for (const scenario of [
  { mode: 'return link' as const, viewport: { width: 390, height: 844 } },
  { mode: 'browser Back' as const, viewport: { width: 1440, height: 900 } },
]) {
  test(`${scenario.mode} settles the article surface into the restored card`, async ({ page }) => {
    const opened = await openCard(page, scenario.viewport, 'read-more')
    await installTransitionProbe(page)

    if (scenario.mode === 'return link') {
      await page.getByRole('link', { name: RETURN_LABEL }).click()
    } else {
      await page.goBack()
    }

    await expect(page).toHaveURL(SOURCE_PATH)
    await expectRestoredScroll(page, opened.sourceScrollY)

    const probe = await waitForProbeRemoval(page)
    const frames = probe.frames

    expect(frames[0].phase).toBe('return-waiting')
    expectRectNear(frames[0], destination(scenario.viewport.width, scenario.viewport.height))
    expectRectNear(frames.at(-1)!, opened.source)
    expectRectNear(frames.at(-1)!.cover, opened.sourceCover)
    expect(frames.some((frame) => frame.phase === 'returning')).toBe(true)
    expect(probe.maxOverlayCount).toBe(1)
    expect(probe.removedAt).toBeLessThanOrEqual(500)
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
    const link = entryLink(page, 'title')
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
  const link = entryLink(page, 'read-more')
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

  await page.getByRole('link', { name: RETURN_LABEL }).click()
  await expect(page).toHaveURL(SOURCE_PATH)
  await expectRestoredScroll(page, opened.sourceScrollY)

  const probe = await waitForProbeRemoval(page)
  expect(probe.frames.every((frame) => frame.phase === 'return-waiting')).toBe(true)
  expect(await card(page).count()).toBe(0)
})

test('modified click opens an independent tab without any transition UI', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Modified-click behavior is desktop-specific')

  await page.goto(SOURCE_PATH)
  const link = entryLink(page, 'read-more')
  await link.scrollIntoViewIfNeeded()
  const popupPromise = page.context().waitForEvent('page')

  await link.click({ modifiers: ['Control'] })
  const popup = await popupPromise

  await expect(page).toHaveURL(SOURCE_PATH)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-article-transition-fallback]')).toHaveCount(0)
  await expect(popup).toHaveURL(ARTICLE_PATH)
  await expect(popup.locator('[data-article-body]')).toContainText(BODY_TEXT)
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

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('direct article content and fallback return remain static and usable', async ({ page }) => {
    await page.goto(ARTICLE_PATH)
    await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: RETURN_LABEL })).toHaveAttribute('href', '/zh/')
  })
})
