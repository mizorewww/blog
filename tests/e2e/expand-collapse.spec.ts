import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function openSecondArticleFromHome(page: Page) {
  await page.goto('/zh/')

  const readMore = page.getByRole('link', { name: /继续阅读/ }).nth(1)
  await readMore.scrollIntoViewIfNeeded()

  const previousScrollY = await page.evaluate(() => window.scrollY)
  expect(previousScrollY).toBeGreaterThan(0)

  await readMore.click()
  await expect(page).toHaveURL(/\/zh\/[^/]+\/$/)
  await expect(page.getByRole('link', { name: /收起文章/ })).toBeVisible()

  return previousScrollY
}

test('collapsing an expanded article restores the exact previous list scroll position', async ({
  page,
}) => {
  const previousScrollY = await openSecondArticleFromHome(page)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.getByRole('link', { name: /收起文章/ }).click()
  await expect(page).toHaveURL(/\/zh\/$/)
  await page.waitForTimeout(700)

  const restoredScrollY = await page.evaluate(() => window.scrollY)
  expect(Math.abs(restoredScrollY - previousScrollY)).toBeLessThanOrEqual(4)
})

test('reduced motion collapse also restores the saved list scroll position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const previousScrollY = await openSecondArticleFromHome(page)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.getByRole('link', { name: /收起文章/ }).click()
  await expect(page).toHaveURL(/\/zh\/$/)
  await page.waitForTimeout(100)

  const restoredScrollY = await page.evaluate(() => window.scrollY)
  expect(Math.abs(restoredScrollY - previousScrollY)).toBeLessThanOrEqual(4)
})
