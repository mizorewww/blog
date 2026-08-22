import { describe, expect, it } from 'vitest'
import {
  buildFrontmatter,
  containsChinese,
  escapeYamlValue,
  formatYamlBoolean,
  formatYamlStringArray,
  parseArgs,
  parseList,
  resolveFolder,
  resolveSlug,
} from '@/scripts/write-blog.mjs'

describe('write-blog helpers', () => {
  describe('containsChinese', () => {
    it('detects CJK characters', () => {
      expect(containsChinese('中文标题')).toBe(true)
      expect(containsChinese('Hello 世界')).toBe(true)
    })

    it('returns false for pure ASCII', () => {
      expect(containsChinese('Hello World')).toBe(false)
      expect(containsChinese('123')).toBe(false)
    })
  })

  describe('resolveSlug', () => {
    it('returns a valid provided slug', () => {
      expect(resolveSlug('my-first-post', 'any title')).toBe('my-first-post')
    })

    it('derives slug from ASCII title when omitted', () => {
      expect(resolveSlug(undefined, 'Hello World!')).toBe('hello-world')
      expect(resolveSlug(undefined, '  Trim  And  Lower  ')).toBe('trim-and-lower')
    })

    it('requires explicit slug for Chinese titles', () => {
      expect(() => resolveSlug(undefined, '中文标题')).toThrow(/必须显式提供 --slug/)
    })

    it('rejects slugs starting or ending with hyphen', () => {
      expect(() => resolveSlug('-start', 'title')).toThrow(/slug 格式不合法/)
      expect(() => resolveSlug('end-', 'title')).toThrow(/slug 格式不合法/)
    })

    it('rejects slugs with invalid characters', () => {
      expect(() => resolveSlug('hello_world', 'title')).toThrow(/slug 格式不合法/)
      expect(() => resolveSlug('hello.world', 'title')).toThrow(/slug 格式不合法/)
      expect(() => resolveSlug('UPPER', 'title')).toThrow(/slug 格式不合法/)
    })

    it('strips trailing markdown extensions before validating', () => {
      expect(resolveSlug('use-grok-bot.md', 'title')).toBe('use-grok-bot')
      expect(resolveSlug('use-grok-bot.mdx', 'title')).toBe('use-grok-bot')
      expect(resolveSlug('use-grok-bot.md.md', 'title')).toBe('use-grok-bot')
      expect(resolveSlug('  kde-plasma-obsdian-web-clipper.MD  ', 'title')).toBe(
        'kde-plasma-obsdian-web-clipper'
      )
    })
  })

  describe('resolveFolder', () => {
    it('normalizes kebab-case segments and nested paths', () => {
      expect(resolveFolder(undefined)).toBe('')
      expect(resolveFolder('hardware')).toBe('hardware')
      expect(resolveFolder('desktop/kde')).toBe('desktop/kde')
    })

    it('rejects relative and reserved segments', () => {
      expect(() => resolveFolder('..')).toThrow(/相对路径/)
      expect(() => resolveFolder('categories')).toThrow(/保留路径段/)
      expect(() => resolveFolder('tags')).toThrow(/保留路径段/)
      expect(() => resolveFolder('search')).toThrow(/保留路径段/)
      expect(() => resolveFolder('Hardware')).toThrow(/folder 段格式不合法/)
    })
  })

  describe('parseList', () => {
    it('parses comma-separated values', () => {
      expect(parseList('a, b, c')).toEqual(['a', 'b', 'c'])
    })

    it('returns empty array for undefined or empty input', () => {
      expect(parseList(undefined)).toEqual([])
      expect(parseList('')).toEqual([])
      expect(parseList('   ')).toEqual([])
    })

    it('filters empty items', () => {
      expect(parseList('a,,b, ,c')).toEqual(['a', 'b', 'c'])
    })
  })

  describe('formatYamlStringArray', () => {
    it('formats arrays with single quotes', () => {
      expect(formatYamlStringArray(['折腾', 'Linux'])).toBe("['折腾', 'Linux']")
    })

    it('escapes single quotes', () => {
      expect(formatYamlStringArray(["it's"])).toBe("['it''s']")
    })

    it('returns empty list for empty array', () => {
      expect(formatYamlStringArray([])).toBe('[]')
    })
  })

  describe('formatYamlBoolean', () => {
    it('formats true and false', () => {
      expect(formatYamlBoolean(true)).toBe('true')
      expect(formatYamlBoolean(false)).toBe('false')
    })

    it('returns undefined for missing value', () => {
      expect(formatYamlBoolean(undefined)).toBeUndefined()
    })
  })

  describe('escapeYamlValue', () => {
    it('leaves simple values unquoted', () => {
      expect(escapeYamlValue('Hello World')).toBe('Hello World')
    })

    it('quotes values with special characters', () => {
      expect(escapeYamlValue('标题：带冒号')).toBe("'标题：带冒号'")
    })

    it('quotes empty string', () => {
      expect(escapeYamlValue('')).toBe("''")
    })

    it('escapes single quotes', () => {
      expect(escapeYamlValue("it's")).toBe("'it''s'")
    })

    it('quotes values containing colon followed by space', () => {
      expect(escapeYamlValue('Hello: World')).toBe("'Hello: World'")
    })

    it('quotes values containing space followed by hash', () => {
      expect(escapeYamlValue('a # b')).toBe("'a # b'")
    })
  })

  describe('buildFrontmatter', () => {
    it('builds minimal frontmatter', () => {
      const frontmatter = buildFrontmatter({
        title: 'Hello',
        date: '2099-01-01',
        locale: 'en',
        authors: ['default'],
      })

      expect(frontmatter).toContain('title: Hello')
      expect(frontmatter).toContain('date: 2099-01-01')
      expect(frontmatter).toContain('language: en')
      expect(frontmatter).toContain("authors: ['default']")
    })

    it('includes optional fields when provided', () => {
      const frontmatter = buildFrontmatter({
        title: 'Hello',
        date: '2099-01-01',
        locale: 'zh',
        summary: '摘要',
        categories: ['折腾'],
        tags: ['Next.js'],
        translationKey: 'hello',
        authors: ['default'],
        image: '/static/images/hello.jpg',
        draft: true,
      })

      expect(frontmatter).toContain("summary: '摘要'")
      expect(frontmatter).toContain("categories: ['折腾']")
      expect(frontmatter).toContain("tags: ['Next.js']")
      expect(frontmatter).toContain('translationKey: hello')
      expect(frontmatter).toContain('image: /static/images/hello.jpg')
      expect(frontmatter).toContain('draft: true')
    })

    it('omits empty optional arrays', () => {
      const frontmatter = buildFrontmatter({
        title: 'Hello',
        date: '2099-01-01',
        locale: 'en',
        categories: [],
        tags: [],
        authors: ['default'],
      })

      expect(frontmatter).not.toContain('categories:')
      expect(frontmatter).not.toContain('tags:')
    })
  })

  describe('parseArgs', () => {
    it('parses flags with values', () => {
      expect(parseArgs(['--title', 'Hello', '--locale', 'en'])).toEqual({
        title: 'Hello',
        locale: 'en',
        _: [],
      })
    })

    it('parses boolean flags', () => {
      expect(parseArgs(['--draft'])).toEqual({ draft: true, _: [] })
    })

    it('collects positional arguments', () => {
      expect(parseArgs(['create', '--title', 'Hello'])).toEqual({
        title: 'Hello',
        _: ['create'],
      })
    })
  })
})
