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

async function expectAtPageTop(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), {
      timeout: 1200,
    })
    .toBeLessThanOrEqual(scrollTolerance)
}

async function expectExpandedArticleAtTargetOffset(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const shell = document.querySelector<HTMLElement>('[data-post-shell]')
          const targetTop = window.matchMedia('(max-width: 639px)').matches ? 88 : 96

          return Math.abs((shell?.getBoundingClientRect().top ?? 0) - targetTop)
        }),
      { timeout: 1600 }
    )
    .toBeLessThanOrEqual(6)
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

async function expectIntentionalArticleMotion(page: Page) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const shells = Array.from(document.querySelectorAll<HTMLElement>('[data-post-shell]'))
          const shellIsAnimating = shells.some((shell) =>
            shell
              .getAnimations({ subtree: true })
              .some((animation) => ['pending', 'running'].includes(animation.playState))
          )
          const body = document.querySelector<HTMLElement>('[data-animata-collapsible]')
          const bodyIsAnimating =
            body
              ?.getAnimations({ subtree: true })
              .some((animation) => ['pending', 'running'].includes(animation.playState)) || false

          return shellIsAnimating || bodyIsAnimating
        }),
      { timeout: 2400 }
    )
    .toBe(true)
}

async function waitForActivePageTransition(page: Page) {
  await page.waitForFunction(
    () => document.querySelector('[data-animata-page-transition="active"]') !== null,
    undefined,
    { timeout: 2000 }
  )
}

async function watchPageTransition(page: Page) {
  await page.evaluate(() => {
    const win = window as Window & {
      __mizorePageTransitionWasActive?: boolean
      __mizorePageTransitionObserver?: MutationObserver
    }
    const target = document.querySelector('[data-animata-page-transition]')
    const sync = () => {
      if (target?.getAttribute('data-animata-page-transition') === 'active') {
        win.__mizorePageTransitionWasActive = true
      }
    }

    win.__mizorePageTransitionWasActive = false
    win.__mizorePageTransitionObserver?.disconnect()
    win.__mizorePageTransitionObserver = undefined

    if (target) {
      win.__mizorePageTransitionObserver = new MutationObserver(sync)
      win.__mizorePageTransitionObserver.observe(target, {
        attributeFilter: ['data-animata-page-transition'],
      })
    }

    sync()
  })
}

async function expectNoWatchedPageTransition(page: Page) {
  await expect(
    page.evaluate(
      () =>
        (window as Window & { __mizorePageTransitionWasActive?: boolean })
          .__mizorePageTransitionWasActive
    )
  ).resolves.toBe(false)
}

test('recent posts sidebar does not render article commit metadata', async ({ page }) => {
  await page.goto('/zh/')

  await expect(page.locator('.blog-sidebar-right a[href*="/commit/"]')).toHaveCount(0)
})

test('related commits are closed by default inside an expanded article', async ({ page }) => {
  await openArticleFromHome(page)

  const commitsButton = page.getByRole('button', { name: /相关提交/ })
  await expect(commitsButton).toBeVisible()
  await expect(commitsButton).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('article a[href*="/commit/"]')).toHaveCount(0)

  await commitsButton.click()
  await expect(commitsButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('article a[href*="/commit/"]').first()).toBeVisible()
})

test('back to top button scrolls the list back to the top', async ({ page }) => {
  await page.goto('/zh/')
  await scrollToPageBottom(page)

  await page.getByRole('button', { name: /回到顶部/ }).click()
  await expectAtPageTop(page)
})

test('manual scrolling interrupts the back-to-top motion without rebound', async ({ page }) => {
  await page.goto('/zh/')
  await scrollToPageBottom(page)

  await page.getByRole('button', { name: /回到顶部/ }).click()
  await page.waitForTimeout(80)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(800)

  await expect(page.evaluate(() => window.scrollY)).resolves.toBeGreaterThan(20)
})

test('stable list cards do not run direct shell animations', async ({ page }) => {
  await page.goto('/zh/')

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-post-shell]')).some((shell) =>
            shell
              .getAnimations()
              .some((animation) => ['pending', 'running'].includes(animation.playState))
          )
        ),
      { timeout: 1200 }
    )
    .toBe(false)
})

test('normal route switches run the generic page transition', async ({ page }) => {
  await page.goto('/zh/')

  const transitionStarted = waitForActivePageTransition(page)
  await page.locator('.header-shell').getByRole('link', { name: '标签' }).click()

  await transitionStarted
  await expect(page).toHaveURL(/\/zh\/tags\/$/)
})

test('opening an article keeps the intentional expansion motion', async ({ page }) => {
  await page.goto('/zh/')
  const link = getArticleEntryLink(page, 2, 'read-more')
  await link.scrollIntoViewIfNeeded()
  await watchPageTransition(page)

  await link.click()
  await expectIntentionalArticleMotion(page)
  await expectNoWatchedPageTransition(page)
  await expect(page).toHaveURL(/\/zh\/[^/]+\/$/)
  await waitForExpandedArticleBody(page)
})

test('direct article navigation to tags runs the generic page transition', async ({ page }) => {
  await openArticleFromHome(page)

  const transitionStarted = waitForActivePageTransition(page)
  await page.locator('.header-shell').getByRole('link', { name: '标签' }).click()

  await transitionStarted
  await expect(page).toHaveURL(/\/zh\/tags\/$/)
})

test('opening the bottom article lands at the reading offset', async ({ page }) => {
  await page.goto('/zh/')
  const shellCount = await page.locator('[data-post-shell]').count()
  const link = getArticleEntryLink(page, shellCount - 1, 'read-more')
  await link.scrollIntoViewIfNeeded()

  await link.click()
  await expect(page).toHaveURL(/\/zh\/[^/]+\/$/)
  await waitForExpandedArticleBody(page)
  await expectExpandedArticleAtTargetOffset(page)
})

async function openArticleFromHome(page: Page, entry: ArticleEntry = 'read-more', index = 2) {
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
    const articleIndex = 2
    const previousScrollY = await openArticleFromHome(page, entry, articleIndex)

    await waitForExpandedArticleBody(page)
    await scrollToPageBottom(page)
    await page.goBack()
    await expect(page).toHaveURL(/\/zh\/$/)
    await expectRestoredScrollY(page, previousScrollY)
  })
}
