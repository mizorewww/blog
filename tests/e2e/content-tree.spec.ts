import { expect, test } from '@playwright/test'

const HOME_PATH = '/zh/'
// Non-ASCII topic folders: page.url() is percent-encoded, while rendered href /
// data-* attributes keep the raw form. See article-reading.spec.ts.
const ARTICLE_HREF = '/zh/折腾/xiaomi-book-pro-14/'
const ARTICLE_PATH = encodeURI(ARTICLE_HREF)
const RICH_ARTICLE_HREF = '/zh/技术/making-memoh-cheaper-on-telegram/'
const RICH_ARTICLE_PATH = encodeURI(RICH_ARTICLE_HREF)
const OLD_ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'

test('list pages keep a date-sorted center and an unlabeled tree on the right', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const tree = page.locator('.blog-sidebar-right [data-content-tree]')
  await expect(tree).toBeVisible()
  await expect(tree.getByRole('heading', { name: '文章导航' })).toHaveClass(/sr-only/)
  await expect(page.locator('body')).not.toContainText('文件夹')
  await expect(page.getByText('folder view', { exact: false })).toHaveCount(0)

  const dates = await page
    .locator('[data-post-shell] [data-article-transition-date] time')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime') || ''))
  const sorted = [...dates].sort((left, right) => right.localeCompare(left))
  expect(dates).toEqual(sorted)

  const folder = tree.getByRole('button', { name: '折腾' })
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toBeVisible()

  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'false')
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
})

test('article pages use a three-column tree rail at 1024px and hide it below', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto(ARTICLE_PATH)

  const tree = page.locator('[data-article-content-tree] [data-content-tree]')
  await expect(page.locator('.article-toc-desktop')).toBeVisible()
  await expect(page.locator('[data-article-surface]')).toBeVisible()
  await expect(tree).toBeVisible()
  await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toHaveAttribute(
    'aria-current',
    'page'
  )

  await page.setViewportSize({ width: 1023, height: 900 })
  await expect(page.locator('[data-article-content-tree]')).toBeHidden()
})

test('list tree post links open the article with a structured tree overlay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const treeLink = page.locator(
    `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
  )
  await expect(treeLink).toBeVisible()
  await treeLink.click()

  await expect
    .poll(async () => page.locator('[data-content-tree-transition-overlay]').count())
    .toBeGreaterThan(0)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(
    '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
  )
})

test('tree overlay keeps source chrome and does not replay collapsible enter', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })

  let releaseArticleRequest!: () => void
  const articleRequestReleased = new Promise<void>((resolve) => {
    releaseArticleRequest = resolve
  })

  await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
    await articleRequestReleased
    await route.continue()
  })

  await page.goto(HOME_PATH)

  const treeLink = page.locator(
    `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
  )
  await expect(treeLink).toBeVisible()
  const clickPromise = treeLink.click()

  try {
    const overlay = page.locator('[data-content-tree-transition-overlay]')
    await expect(overlay).toBeVisible()
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(overlay.locator('[data-content-tree]')).toHaveAttribute(
      'data-content-tree-chrome',
      'sidebar'
    )
    await expect(overlay.locator('[data-content-tree]')).toHaveAttribute(
      'data-content-tree-flight',
      'true'
    )
    await expect(overlay.locator('[data-animata-collapsible]')).toHaveCount(0)
    await expect(overlay.locator('[data-content-tree-open="true"]')).not.toHaveCount(0)
    await expect(overlay.locator('[data-content-tree-folder="折腾"]')).toHaveAttribute(
      'data-content-tree-open',
      'true'
    )
    await expect(
      overlay.locator('[data-content-tree-post="折腾/xiaomi-book-pro-14"]')
    ).toBeVisible()

    const box = await overlay.boundingBox()
    expect(box).not.toBeNull()
    expect(box?.width).toBeGreaterThan(80)
    expect(box?.width).toBeLessThan(400)
  } finally {
    releaseArticleRequest()
    await clickPromise
  }

  await expect(page).toHaveURL(ARTICLE_PATH)
})

test('article tree switches fade the reading surface without moving TOC or tree', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })

  let releaseArticleRequest!: () => void
  const articleRequestReleased = new Promise<void>((resolve) => {
    releaseArticleRequest = resolve
  })

  await page.route(`**${RICH_ARTICLE_PATH}index.txt*`, async (route) => {
    await articleRequestReleased
    await route.continue()
  })

  await page.goto(ARTICLE_PATH)

  const nextLink = page.locator(
    `[data-article-content-tree] a[data-blog-post-link][href="${RICH_ARTICLE_HREF}"]`
  )
  await expect(nextLink).toBeVisible()
  const clickPromise = nextLink.click()

  try {
    await expect
      .poll(async () => page.locator('[data-article-surface-veil]').count())
      .toBeGreaterThan(0)
    await expect(page.locator('[data-content-tree-transition-overlay]')).toHaveCount(0)
  } finally {
    releaseArticleRequest()
    await clickPromise
  }

  await expect(page).toHaveURL(RICH_ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
})

test('reduced motion skips tree translate and the surface veil', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  await page
    .locator(
      `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
    )
    .click()

  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-surface-veil]')).toHaveCount(0)
  await expect(page.locator('[data-article-body]')).toBeVisible()
})

test('old flat article URLs permanently redirect to topic folders', async ({ request }) => {
  const response = await request.get(OLD_ARTICLE_PATH, { maxRedirects: 0 })

  expect(response.status()).toBe(301)
  expect(response.headers().location).toBe(ARTICLE_PATH)
})

test.describe('no-js content tree', () => {
  test.use({ javaScriptEnabled: false })

  test('renders open folders and post leaves in static HTML', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(HOME_PATH)

    const tree = page.locator('.blog-sidebar-right [data-content-tree]')
    await expect(tree).toBeVisible()
    await expect(tree.getByRole('button', { name: '折腾' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('文件夹')
  })
})
