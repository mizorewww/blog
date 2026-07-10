import { expect, test, type Page } from '@playwright/test'

type TermRoute = {
  locale: 'zh' | 'en'
  section: 'categories' | 'tags'
  navigationLabel: string
  indexHeading: string
  indexPath: string
  detailHeading: string
  detailPath: string
}

const termRoutes: TermRoute[] = [
  {
    locale: 'zh',
    section: 'categories',
    navigationLabel: '分类',
    indexHeading: '全部分类',
    indexPath: '/zh/categories/',
    detailHeading: '折腾',
    detailPath: '/zh/categories/%E6%8A%98%E8%85%BE/',
  },
  {
    locale: 'zh',
    section: 'tags',
    navigationLabel: '标签',
    indexHeading: '全部标签',
    indexPath: '/zh/tags/',
    detailHeading: 'Linux',
    detailPath: '/zh/tags/linux/',
  },
  {
    locale: 'en',
    section: 'categories',
    navigationLabel: 'Categories',
    indexHeading: 'Categories',
    indexPath: '/en/categories/',
    detailHeading: '折腾',
    detailPath: '/en/categories/%E6%8A%98%E8%85%BE/',
  },
  {
    locale: 'en',
    section: 'tags',
    navigationLabel: 'Tags',
    indexHeading: 'Tags',
    indexPath: '/en/tags/',
    detailHeading: 'Linux',
    detailPath: '/en/tags/linux/',
  },
]

async function navigateFromPrimaryNavigation(page: Page, route: TermRoute) {
  const header = page.getByRole('banner')
  const openNavigationLabel = route.locale === 'zh' ? '打开导航' : 'Open navigation'
  const navigationLabel = route.locale === 'zh' ? '主导航' : 'Primary navigation'

  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 640) {
    await header.getByRole('button', { name: openNavigationLabel }).click()
  }

  await header
    .getByRole('navigation', { name: navigationLabel })
    .getByRole('link', { name: route.navigationLabel, exact: true })
    .click()
}

function expectNoStreamingFallback(html: string) {
  expect(html).not.toContain('id="B:0"')
  expect(html).not.toContain('id="S:0"')
  expect(html).not.toContain('animata-shimmer')
}

test.describe('term routes without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  for (const route of termRoutes) {
    test(`${route.locale} ${route.section} index is present in the initial document`, async ({
      page,
    }) => {
      const response = await page.goto(route.indexPath)

      expect(response?.status()).toBe(200)
      expectNoStreamingFallback((await response?.text()) || '')
      await expect(page.getByRole('heading', { level: 1, name: route.indexHeading })).toBeVisible()
      await expect(page.locator(`main a[href="${decodeURI(route.detailPath)}"]`)).toBeVisible()
      await expect(page.locator('[class*="animata-shimmer"]')).toHaveCount(0)
    })

    test(`${route.locale} ${route.section} detail is present in the initial document`, async ({
      page,
    }) => {
      const response = await page.goto(route.detailPath)

      expect(response?.status()).toBe(200)
      expectNoStreamingFallback((await response?.text()) || '')
      await expect(page.getByRole('heading', { level: 1, name: route.detailHeading })).toBeVisible()
      await expect(page.locator('main [data-post-shell]').first()).toBeVisible()
      await expect(page.locator('[class*="animata-shimmer"]')).toHaveCount(0)
    })
  }
})

for (const route of termRoutes) {
  test(`${route.locale} ${route.section} navigates from the header through a term chip`, async ({
    page,
  }) => {
    await page.goto(`/${route.locale}/`)
    await navigateFromPrimaryNavigation(page, route)

    await expect(page).toHaveURL(route.indexPath)
    await expect(page.getByRole('heading', { level: 1, name: route.indexHeading })).toBeVisible()

    await page.locator(`main a[href="${decodeURI(route.detailPath)}"]`).click()

    await expect(page).toHaveURL(route.detailPath)
    await expect(page.getByRole('heading', { level: 1, name: route.detailHeading })).toBeVisible()
    await expect(page.locator('main [data-post-shell]').first()).toBeVisible()
  })
}
