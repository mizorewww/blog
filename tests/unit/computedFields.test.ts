import { describe, expect, it } from 'vitest'
import { stripMarkdownSlugExtension } from '../../contentlayer/config/computedFields'

describe('blog slug hardening', () => {
  it('strips trailing markdown extensions from flattened path slugs', () => {
    expect(stripMarkdownSlugExtension('tech/use-grok-bot.md')).toBe('tech/use-grok-bot')
    expect(stripMarkdownSlugExtension('tech/use-grok-bot.md.md')).toBe('tech/use-grok-bot')
    expect(stripMarkdownSlugExtension('hardware/xiaomi-book-pro-14.mdx')).toBe(
      'hardware/xiaomi-book-pro-14'
    )
    expect(stripMarkdownSlugExtension('hardware/xiaomi-book-pro-14')).toBe(
      'hardware/xiaomi-book-pro-14'
    )
  })
})
