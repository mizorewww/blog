import { expect, test, type Page } from '@playwright/test'

async function scrollToPageBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
}

async function navigateFromPrimaryNavigation(page: Page, linkName: string) {
  const header = page.locator('.header-shell')

  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) < 640) {
    await header.getByRole('button', { name: '打开导航' }).click()
  }

  const navigation = header.locator('nav[aria-label="主导航"]:visible')
  await expect(navigation).toBeVisible()
  await navigation.getByRole('link', { name: linkName, exact: true }).click()
}

test('recent posts do not render article commit metadata', async ({ page }) => {
  await page.goto('/zh/')

  await expect(page.locator('.blog-sidebar-right a[href*="/commit/"]')).toHaveCount(0)
  await expect(page.locator('.blog-sidebar-right [data-content-tree]')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('文件夹')
})

test('back to top returns the list to the top', async ({ page }) => {
  await page.goto('/zh/')
  await scrollToPageBottom(page)

  await page.getByRole('button', { name: /回到顶部/ }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(8)
})

test('home, category, and tag navigation never resolves to a blank route', async ({ page }) => {
  await page.goto('/zh/')

  await navigateFromPrimaryNavigation(page, '分类')
  await expect(page).toHaveURL('/zh/categories/')
  await expect(page.getByRole('heading', { level: 1, name: '全部分类' })).toBeVisible()

  await navigateFromPrimaryNavigation(page, '标签')
  await expect(page).toHaveURL('/zh/tags/')
  await expect(page.getByRole('heading', { level: 1, name: '全部标签' })).toBeVisible()

  await navigateFromPrimaryNavigation(page, '首页')
  await expect(page).toHaveURL('/zh/')
  await expect(page.locator('[data-post-shell]').first()).toBeVisible()
})
