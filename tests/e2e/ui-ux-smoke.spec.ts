import { expect, test, type Locator, type Page } from '@playwright/test'

// Rendered href attributes keep the raw (decoded) non-ASCII folder name.
const ARTICLE_HREF = '/zh/折腾/xiaomi-book-pro-14/'

async function expectTouchTarget(locator: Locator, minSize = 44) {
  const box = await locator.boundingBox()

  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(minSize)
  expect(box!.height).toBeGreaterThanOrEqual(minSize)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(0)
}

async function expectInFirstViewport(locator: Locator, page: Page) {
  const [box, viewport] = await Promise.all([locator.boundingBox(), page.viewportSize()])

  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeLessThan(viewport!.height)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`mobile 404 keeps its content visible at 375px in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 375, height: 812 })
    const response = await page.goto('/zh/__missing_ui_ux_page__/')

    expect(response?.status()).toBe(404)
    const heading = page.getByRole('heading', { level: 1, name: '抱歉，找不到这个页面。' })
    const homeLink = page.getByRole('link', { name: '回到首页' })

    await expect(heading).toBeVisible()
    await expect(homeLink).toBeVisible()
    await expectInFirstViewport(page.locator('[data-not-found-content]'), page)
    await expectInFirstViewport(page.locator('[data-not-found-code]'), page)
    await expectInFirstViewport(homeLink, page)

    const codeBox = await page.locator('[data-not-found-code]').boundingBox()

    expect(codeBox).not.toBeNull()
    expect(codeBox!.x).toBeGreaterThanOrEqual(15)
    expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(375)
    await expectNoHorizontalOverflow(page)
  })
}

test('localized 404 keeps its home link in the current locale', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  const response = await page.goto('/en/__missing_ui_ux_page__/')

  expect(response?.status()).toBe(404)
  await expect(
    page.getByRole('heading', { level: 1, name: "Sorry, we couldn't find this page." })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to homepage' })).toHaveAttribute('href', '/en/')
  await expectNoHorizontalOverflow(page)
})

test('mobile home shows denser cards without shrinking real targets', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/zh/')

  const firstCard = page.locator('[data-post-shell]').first()
  const secondCard = page.locator('[data-post-shell]').nth(1)
  const firstBox = await firstCard.boundingBox()
  const secondBox = await secondCard.boundingBox()
  const languageSwitch = page.locator('[data-language-switcher-mobile]')
  const themeButton = page.getByRole('button', { name: '切换暗色模式' })
  const menuButton = page.getByRole('button', { name: '打开导航' })
  const logoLink = page.locator('[data-header-logo] a')

  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  expect(firstBox!.height).toBeLessThanOrEqual(350)
  expect(secondBox!.y).toBeLessThan(500)
  await expectTouchTarget(languageSwitch)
  await expectTouchTarget(themeButton)
  await expectTouchTarget(menuButton)
  await expectTouchTarget(logoLink)
  await expectNoHorizontalOverflow(page)
})

test('desktop sidebars read lighter than the main post card', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/zh/')

  const weights = await page.evaluate(() => {
    const mainCard = document.querySelector<HTMLElement>('[data-post-shell]')
    const profileCard = document.querySelector<HTMLElement>('[data-profile-card]')
    const widgetCard = document.querySelector<HTMLElement>('[data-blog-widget-card]')

    if (!mainCard || !profileCard || !widgetCard) {
      throw new Error('Expected main and sidebar cards')
    }

    return {
      mainShadow: getComputedStyle(mainCard).boxShadow,
      profileShadow: getComputedStyle(profileCard).boxShadow,
      widgetShadow: getComputedStyle(widgetCard).boxShadow,
      mainBackground: getComputedStyle(mainCard).backgroundColor,
      widgetBackground: getComputedStyle(widgetCard).backgroundColor,
    }
  })

  expect(weights.mainShadow).not.toBe(weights.widgetShadow)
  expect(weights.profileShadow).not.toBe(weights.mainShadow)
  expect(weights.widgetBackground).not.toBe(weights.mainBackground)

  for (const link of await page.locator('.blog-sidebar-left a').all()) {
    await expectTouchTarget(link)
  }
})

test('search exposes a stable status region and busy result updates', async ({ page }) => {
  let releasePagefind!: () => void
  const pagefindReleased = new Promise<void>((resolve) => {
    releasePagefind = resolve
  })
  let delayedPagefindRequests = 0

  await page.route('**/pagefind/pagefind.js', async (route) => {
    delayedPagefindRequests += 1
    await pagefindReleased
    await route.continue()
  })

  await page.goto('/zh/search/')

  const searchLandmark = page.locator('[role="search"]')
  const searchbox = page.getByRole('searchbox', { name: '搜索' })
  const status = page.getByRole('status')
  const resultsRegion = page.locator('[data-search-results]')

  await expect(searchLandmark).toBeVisible()
  await expect(status).toHaveText('输入关键词开始搜索。')
  await expect(resultsRegion).toHaveAttribute('aria-busy', 'false')

  await searchbox.fill('小米')

  await expect.poll(() => delayedPagefindRequests).toBeGreaterThan(0)
  await expect(status).toHaveText('正在搜索「小米」。')
  await expect(resultsRegion).toHaveAttribute('aria-busy', 'true')

  releasePagefind()

  await expect(page.locator(`a[data-blog-post-link][href="${ARTICLE_HREF}"]`)).toBeVisible()
  await expect(status).toContainText('找到')
  await expect(resultsRegion).toHaveAttribute('aria-busy', 'false')

  await searchbox.fill('zzzxxyqnohit260804')

  await expect(status).toContainText('未找到')
  await expect(resultsRegion).toHaveAttribute('aria-busy', 'false')
})

test('search states stay compact and expose result and empty states at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto('/zh/search/')

  const resultsRegion = page.locator('[data-search-results]')
  const resultsBox = await resultsRegion.boundingBox()

  expect(resultsBox).not.toBeNull()
  expect(resultsBox!.y).toBeLessThan(220)
  await expect(resultsRegion).toHaveAttribute('data-search-state', 'idle')

  await page.getByRole('searchbox', { name: '搜索' }).fill('小米')
  await expect(page.locator('[data-search-result-card]').first()).toBeVisible()
  await expect(resultsRegion).toHaveAttribute('data-search-state', 'results')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('searchbox', { name: '搜索' }).fill('zzzxxyqnohit260804')
  await expect(resultsRegion).toHaveAttribute('data-search-state', 'empty')
  await expect(page.getByRole('status')).toContainText('未找到')
})

test('search reports a recoverable error when the static index runtime is unavailable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.route('**/pagefind/pagefind.js', (route) => route.abort())
  await page.goto('/zh/search/')

  const resultsRegion = page.locator('[data-search-results]')

  await page.getByRole('searchbox', { name: '搜索' }).fill('小米')
  await expect(resultsRegion).toHaveAttribute('data-search-state', 'error')
  await expect(page.getByRole('status')).toContainText('搜索索引暂不可用')
  await expectNoHorizontalOverflow(page)
})

for (const path of ['/zh/categories/', '/zh/tags/'] as const) {
  test(`${path} term chips keep 44px targets without oversized visual height`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(path)

    const chips = await page.locator('[data-term-chip]').all()
    expect(chips.length).toBeGreaterThan(0)

    for (const chip of chips) {
      const box = await chip.boundingBox()

      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeLessThanOrEqual(52)
    }

    await expectNoHorizontalOverflow(page)
  })
}

for (const { path, heading } of [
  { path: '/zh/categories/%E6%8A%98%E8%85%BE/', heading: '分类：折腾' },
  { path: '/zh/tags/linux/', heading: '#Linux' },
  { path: '/en/categories/%E6%8A%98%E8%85%BE/', heading: 'Category: 折腾' },
  { path: '/en/tags/linux/', heading: '#Linux' },
] as const) {
  test(`${path} exposes a compact visible term context heading at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto(path)

    const title = page.locator('[data-list-page-heading="visible"]')
    const firstCard = page.locator('[data-post-shell]').first()
    const titleBox = await title.boundingBox()
    const firstCardBox = await firstCard.boundingBox()

    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    expect(titleBox).not.toBeNull()
    expect(firstCardBox).not.toBeNull()
    expect(titleBox!.y).toBeLessThan(140)
    expect(firstCardBox!.y - (titleBox!.y + titleBox!.height)).toBeLessThanOrEqual(24)
    await expectNoHorizontalOverflow(page)
  })
}

test('footer social links and desktop RSS expose comfortable targets', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/zh/')

  await expectTouchTarget(page.getByRole('link', { name: '订阅 Atom RSS' }), 40)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  for (const name of ['电子邮件', 'GitHub', 'X', 'Telegram']) {
    await expectTouchTarget(page.getByRole('contentinfo').getByRole('link', { name }))
  }
})

test('footer metadata separators stay grouped with following content at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 812 })
  await page.goto('/zh/categories/')

  const footer = page.getByRole('contentinfo')
  const commitUnit = footer.locator('[data-footer-meta-unit="commit"]')
  const commitLink = commitUnit.getByRole('link', { name: /最新提交/ })
  const [unitBox, linkBox, unitText] = await Promise.all([
    commitUnit.boundingBox(),
    commitLink.boundingBox(),
    commitUnit.innerText(),
  ])

  expect(unitBox).not.toBeNull()
  expect(linkBox).not.toBeNull()
  expect(unitBox!.height).toBeLessThanOrEqual(36)
  expect(unitText.trim().startsWith('•')).toBe(false)
  await expectTouchTarget(commitLink, 32)
  await expectNoHorizontalOverflow(page)
})

test('client route changes move focus to the main landmark without scroll jumps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/zh/')

  await page.getByRole('banner').getByRole('link', { name: '分类', exact: true }).click()
  await expect(page).toHaveURL('/zh/categories/')
  await expect(page.locator('#main-content')).toBeFocused()
  await expectNoHorizontalOverflow(page)
})
