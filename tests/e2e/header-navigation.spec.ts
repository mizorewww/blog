import { expect, test, type Locator, type Page } from '@playwright/test'

const ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(0)
}

async function expectNoIntersection(first: Locator, second: Locator) {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()])

  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()

  const intersects = !(
    firstBox!.x + firstBox!.width <= secondBox!.x ||
    secondBox!.x + secondBox!.width <= firstBox!.x ||
    firstBox!.y + firstBox!.height <= secondBox!.y ||
    secondBox!.y + secondBox!.height <= firstBox!.y
  )

  expect(intersects).toBe(false)
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const [box, viewport] = await Promise.all([locator.boundingBox(), page.viewportSize()])

  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
}

for (const { width, locale, openLabel, closeLabel, navigationLabel, activeLink } of [
  {
    width: 320,
    locale: 'zh',
    openLabel: '打开导航',
    closeLabel: '关闭导航',
    navigationLabel: '主导航',
    activeLink: '首页',
  },
  {
    width: 390,
    locale: 'en',
    openLabel: 'Open navigation',
    closeLabel: 'Close navigation',
    navigationLabel: 'Primary navigation',
    activeLink: 'Home',
  },
] as const) {
  test(`${locale} mobile header fits at ${width}px and exposes a localized disclosure`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/${locale}/`)

    const header = page.getByRole('banner')
    const logo = header.locator('[data-header-logo]')
    const controls = header.locator('[data-header-controls]')
    const button = header.getByRole('button', { name: openLabel })
    const languageSwitcher = controls.locator('[data-header-language-switcher]')
    const themeButton = controls.getByRole('button', {
      name: locale === 'zh' ? '切换暗色模式' : 'Toggle dark mode',
    })
    const desktopNavigation = header
      .getByRole('navigation', { name: navigationLabel })
      .filter({ has: header.locator('[data-animata-nav-active-underline]') })

    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toHaveAttribute('aria-controls', 'mobile-primary-navigation')
    await expect(button).toHaveCSS('width', '44px')
    await expect(button).toHaveCSS('height', '44px')
    await expect(desktopNavigation).toBeHidden()
    await expectNoIntersection(logo, controls)
    await expectInsideViewport(languageSwitcher, page)
    await expectInsideViewport(themeButton, page)
    await expectInsideViewport(button, page)
    await expectNoHorizontalOverflow(page)

    await button.click()

    const closeButton = header.getByRole('button', { name: closeLabel })
    const navigation = header.getByRole('navigation', { name: navigationLabel })

    await expect(closeButton).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation).toBeVisible()
    await expect(navigation.getByRole('link', { name: activeLink, exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(navigation.locator('[data-animata-nav-active-underline]')).toHaveCount(0)
    await expect(navigation.locator('[role="menu"]')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
}

test('mobile disclosure closes on Escape, route changes, and the desktop breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/zh/')

  const header = page.getByRole('banner')
  const openButton = header.getByRole('button', { name: '打开导航' })

  await openButton.click()
  await header
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '首页', exact: true })
    .click()
  await expect(openButton).toHaveAttribute('aria-expanded', 'false')

  await openButton.click()
  await page.keyboard.press('Escape')
  await expect(openButton).toHaveAttribute('aria-expanded', 'false')
  await expect(openButton).toBeFocused()

  await openButton.click()
  await header
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '分类', exact: true })
    .click()
  await expect(page).toHaveURL('/zh/categories/')
  await expect(openButton).toHaveAttribute('aria-expanded', 'false')

  await openButton.click()
  await page.setViewportSize({ width: 640, height: 844 })
  await expect(openButton).toBeHidden()
  await expect(header.locator('#mobile-primary-navigation')).toHaveCount(0)
  await expect(header.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(
    header
      .getByRole('navigation', { name: '主导航' })
      .getByRole('link', { name: '分类', exact: true })
  ).toBeVisible()
})

test('an open mobile disclosure keeps the reading header visible while scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(ARTICLE_PATH)

  const header = page.getByRole('banner')
  await header.getByRole('button', { name: '打开导航' }).click()
  await page.evaluate(() =>
    window.scrollTo(0, Math.min(1200, document.documentElement.scrollHeight))
  )

  await expect
    .poll(() =>
      header.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return rect.bottom > 0 && Number.parseFloat(style.opacity) === 1
      })
    )
    .toBe(true)
  await expect(header.getByRole('navigation', { name: '主导航' })).toBeVisible()
})

for (const width of [640, 1440]) {
  test(`desktop navigation remains visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/zh/')

    const header = page.getByRole('banner')

    await expect(header.getByRole('button', { name: '打开导航' })).toBeHidden()
    await expect(header.getByRole('link', { name: '首页', exact: true })).toBeVisible()
    await expect(header.getByRole('link', { name: '搜索', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}

test('the reduced-motion mobile disclosure has no panel animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/zh/')
  await page.getByRole('button', { name: '打开导航' }).click()

  const navigation = page.getByRole('navigation', { name: '主导航' })

  await expect(navigation).toBeVisible()
  expect(
    await navigation.evaluate((element) => element.getAnimations({ subtree: true }).length)
  ).toBe(0)
})
