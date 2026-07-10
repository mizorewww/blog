import { expect, test } from '@playwright/test'

async function scrollToPageBottom(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
}

test('recent posts do not render article commit metadata', async ({ page }) => {
  await page.goto('/zh/')

  await expect(page.locator('.blog-sidebar-right a[href*="/commit/"]')).toHaveCount(0)
})

test('back to top returns the list to the top', async ({ page }) => {
  await page.goto('/zh/')
  await scrollToPageBottom(page)

  await page.getByRole('button', { name: /回到顶部/ }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(8)
})

test('home, category, and tag navigation never resolves to a blank route', async ({ page }) => {
  await page.goto('/zh/')
  const header = page.locator('.header-shell')

  await header.getByRole('link', { name: '分类', exact: true }).click()
  await expect(page).toHaveURL('/zh/categories/')
  await expect(page.getByRole('heading', { level: 1, name: '全部分类' })).toBeVisible()

  await header.getByRole('link', { name: '标签', exact: true }).click()
  await expect(page).toHaveURL('/zh/tags/')
  await expect(page.getByRole('heading', { level: 1, name: '全部标签' })).toBeVisible()

  await header.getByRole('link', { name: '首页', exact: true }).click()
  await expect(page).toHaveURL('/zh/')
  await expect(page.locator('[data-post-shell]').first()).toBeVisible()
})
