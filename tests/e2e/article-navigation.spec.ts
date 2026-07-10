import { expect, test, type Page } from '@playwright/test'

const ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'
const SOURCE_PATH = '/zh/categories/%E6%8A%98%E8%85%BE/'
const TITLE = '小米Book Pro 14 Linux使用体验'
const BODY_TEXT = '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
const ARTICLE_RETURN_MARKER_KEY = 'mizore:article-return'
const scrollTolerance = 10

type ArticleEntry = 'cover' | 'read-more' | 'title'

function articleCard(page: Page) {
  return page.locator(`[data-post-shell="zh/xiaomi-book-pro-14"]`)
}

function articleEntryLink(page: Page, entry: ArticleEntry) {
  const card = articleCard(page)

  if (entry === 'cover') {
    return card.locator(':scope > a[data-blog-post-link]')
  }

  if (entry === 'title') {
    return card.locator('h2 a[data-blog-post-link]')
  }

  return card.getByRole('link', { name: /继续阅读/ })
}

function returnLink(page: Page) {
  return page.getByRole('link', { name: '返回列表' })
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

for (const entry of ['cover', 'title', 'read-more'] as const) {
  test(`the ${entry} card entry is an ordinary article link`, async ({ page }) => {
    await openArticleFromCategory(page, entry)

    await expect(page.locator('main article[data-article-reader]')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.locator('[data-post-shell]')).toHaveCount(0)
  })
}

test('direct article entry renders one static reader with a safe return link', async ({ page }) => {
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

  const link = returnLink(page)
  await expect(link).toHaveAttribute('href', '/zh/')
  await expect(link).toBeInViewport()
})

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

test('a modified article click opens an independent tab without a return marker', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Modified-click semantics are covered on desktop')

  await page.goto(SOURCE_PATH)
  const link = articleEntryLink(page, 'read-more')
  await link.scrollIntoViewIfNeeded()

  const popupPromise = page.context().waitForEvent('page')
  await link.click({ modifiers: ['Control'] })
  const popup = await popupPromise

  await expect(page).toHaveURL(SOURCE_PATH)
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

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('article title, body, and home fallback remain usable', async ({ page }) => {
    const response = await page.goto(ARTICLE_PATH)

    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible()
    await expect(page.locator('[data-article-body]')).toContainText(BODY_TEXT)
    await expect(returnLink(page)).toHaveAttribute('href', '/zh/')

    await returnLink(page).click()
    await expect(page).toHaveURL('/zh/')
  })
})
