import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const scrollTolerance = 4

type ArticleEntry = 'cover' | 'read-more' | 'title'

function getArticleEntryLink(page: Page, index: number, entry: ArticleEntry) {
  const shell = page.locator('[data-post-shell]').nth(index)

  if (entry === 'cover') {
    return shell.locator('article > a').first()
  }

  if (entry === 'title') {
    return shell.locator('h1 a, h2 a').first()
  }

  return shell.getByRole('link', { name: /继续阅读/ })
}

async function scrollToPageBottom(page: Page) {
  await page.evaluate(() => {
    const root = document.documentElement
    const previousScrollBehavior = root.style.scrollBehavior

    root.style.scrollBehavior = 'auto'
    window.scrollTo(0, document.documentElement.scrollHeight)
    root.style.scrollBehavior = previousScrollBehavior
  })
}

async function expectRestoredScrollY(page: Page, previousScrollY: number) {
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - previousScrollY), {
      timeout: 1200,
    })
    .toBeLessThanOrEqual(scrollTolerance)
}

async function waitForExpandedArticleBody(page: Page) {
  await expect(page.getByRole('link', { name: /收起文章/ })).toBeVisible()
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const body = document.querySelector<HTMLElement>('[data-animata-collapsible]')

          if (!body || body.getBoundingClientRect().height <= 0) {
            return false
          }

          return body
            .getAnimations({ subtree: true })
            .every((animation) => !['pending', 'running'].includes(animation.playState))
        }),
      { timeout: 3000 }
    )
    .toBe(true)
}

async function openArticleFromHome(page: Page, entry: ArticleEntry = 'read-more', index = 1) {
  await page.goto('/zh/')
  await page.evaluate(() => {
    ;(window as Window & { __mizoreSpaNavigationMarker?: string }).__mizoreSpaNavigationMarker =
      'alive'
  })

  const link = getArticleEntryLink(page, index, entry)
  await link.scrollIntoViewIfNeeded()

  const previousScrollY = await page.evaluate(() => window.scrollY)
  expect(previousScrollY).toBeGreaterThan(0)

  await link.click()
  await expect(page).toHaveURL(/\/zh\/[^/]+\/$/)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __mizoreSpaNavigationMarker?: string }).__mizoreSpaNavigationMarker
      )
    )
    .toBe('alive')
  await expect(page.getByRole('link', { name: /收起文章/ })).toBeVisible()

  return previousScrollY
}

test('collapsing an expanded article restores the exact previous list scroll position', async ({
  page,
}) => {
  const previousScrollY = await openArticleFromHome(page)

  await scrollToPageBottom(page)
  await page.getByRole('link', { name: /收起文章/ }).click()
  await expect(page).toHaveURL(/\/zh\/$/)
  await expectRestoredScrollY(page, previousScrollY)
})

test('reduced motion collapse also restores the saved list scroll position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const previousScrollY = await openArticleFromHome(page)

  await scrollToPageBottom(page)
  await page.getByRole('link', { name: /收起文章/ }).click()
  await expect(page).toHaveURL(/\/zh\/$/)
  await expectRestoredScrollY(page, previousScrollY)
})

for (const entry of ['read-more', 'title', 'cover'] as const) {
  test(`browser Back from the ${entry} article link restores the saved list scroll position`, async ({
    page,
  }) => {
    const articleIndex = entry === 'read-more' ? 0 : 1
    const previousScrollY = await openArticleFromHome(page, entry, articleIndex)

    await waitForExpandedArticleBody(page)
    await scrollToPageBottom(page)
    await page.goBack()
    await expect(page).toHaveURL(/\/zh\/$/)
    await expectRestoredScrollY(page, previousScrollY)
  })
}
