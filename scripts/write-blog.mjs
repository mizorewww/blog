import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {Object} BlogOptions
 * @property {string} title
 * @property {string} locale
 * @property {string} [slug]
 * @property {string} [folder]
 * @property {string} [date]
 * @property {string} [summary]
 * @property {string[]} [categories]
 * @property {string[]} [tags]
 * @property {string} [translationKey]
 * @property {string[]} [authors]
 * @property {string} [image]
 * @property {boolean} [draft]
 */

const VALID_LOCALES = ['zh', 'en']
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MARKDOWN_SLUG_EXTENSION = /(?:\.(?:md|mdx))+$/i
const RESERVED_FOLDER_SEGMENTS = new Set(['categories', 'tags', 'search'])

/**
 * Strip a trailing Markdown filename extension from a slug or basename.
 * @param {string} value
 * @returns {string}
 */
export function stripMarkdownSlugExtension(value) {
  return String(value).replace(MARKDOWN_SLUG_EXTENSION, '')
}

/**
 * Check if a string contains CJK characters.
 * @param {string} text
 * @returns {boolean}
 */
export function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

/**
 * Validate and normalize a slug.
 * @param {string | undefined} slug
 * @param {string} title
 * @returns {string}
 */
export function resolveSlug(slug, title) {
  if (!slug) {
    if (containsChinese(title)) {
      throw new Error(
        '中文标题必须显式提供 --slug（格式：小写字母、数字、连字符，不以连字符开头或结尾）'
      )
    }
    slug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  } else {
    slug = stripMarkdownSlugExtension(String(slug).trim())
  }

  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug 格式不合法: "${slug}"，只允许小写字母、数字、连字符，且不以连字符开头或结尾`
    )
  }

  return slug
}

/**
 * Validate topic folder segments for nested blog paths.
 * @param {string | undefined} folder
 * @returns {string}
 */
export function resolveFolder(folder) {
  if (!folder) {
    return ''
  }

  const segments = String(folder)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    return ''
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`folder 不能包含相对路径段: "${segment}"`)
    }

    if (RESERVED_FOLDER_SEGMENTS.has(segment)) {
      throw new Error(`folder 不能使用保留路径段: "${segment}"`)
    }

    if (!SLUG_PATTERN.test(segment)) {
      throw new Error(
        `folder 段格式不合法: "${segment}"，只允许小写字母、数字、连字符，且不以连字符开头或结尾`
      )
    }
  }

  return segments.join('/')
}

/**
 * Parse a comma-separated list argument into an array of trimmed strings.
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function parseList(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Format a string array as a YAML flow sequence.
 * @param {string[]} items
 * @returns {string}
 */
export function formatYamlStringArray(items) {
  if (items.length === 0) return '[]'
  return `[${items.map((item) => `'${item.replace(/'/g, "''")}'`).join(', ')}]`
}

/**
 * Format a boolean for YAML frontmatter.
 * @param {boolean | undefined} value
 * @returns {string | undefined}
 */
export function formatYamlBoolean(value) {
  if (typeof value !== 'boolean') return undefined
  return value ? 'true' : 'false'
}

/**
 * Build YAML frontmatter from options.
 * @param {BlogOptions} options
 * @returns {string}
 */
export function buildFrontmatter(options) {
  const { title, date, summary, categories, tags, locale, translationKey, authors, image, draft } =
    options

  const lines = [`---`, `title: ${escapeYamlValue(title)}`, `date: ${date}`]

  if (summary !== undefined) {
    lines.push(`summary: ${escapeYamlValue(summary)}`)
  }

  if (categories && categories.length > 0) {
    lines.push(`categories: ${formatYamlStringArray(categories)}`)
  }

  if (tags && tags.length > 0) {
    lines.push(`tags: ${formatYamlStringArray(tags)}`)
  }

  lines.push(`language: ${locale}`)

  if (translationKey) {
    lines.push(`translationKey: ${translationKey}`)
  }

  if (authors && authors.length > 0) {
    lines.push(`authors: ${formatYamlStringArray(authors)}`)
  }

  if (image) {
    lines.push(`image: ${image}`)
  }

  const draftValue = formatYamlBoolean(draft)
  if (draftValue !== undefined) {
    lines.push(`draft: ${draftValue}`)
  }

  lines.push(`---`, '')
  return lines.join('\n')
}

/**
 * Escape a scalar YAML value. Uses single quotes when necessary.
 * @param {string} value
 * @returns {string}
 */
export function escapeYamlValue(value) {
  if (value === '') return "''"
  if (
    /^[\w\s./@:-]+$/.test(value) &&
    !value.startsWith(' ') &&
    !value.endsWith(' ') &&
    !value.includes(': ') &&
    !value.includes(' #')
  ) {
    return value
  }
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Parse CLI arguments into a structured object.
 * @param {string[]} args
 * @returns {{ [key: string]: string | boolean | string[] | undefined; _: string[] }}
 */
export function parseArgs(args) {
  /** @type {{ [key: string]: string | boolean | undefined }} */
  const flags = {}
  const positional = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = args[i + 1]

      if (next !== undefined && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg)
    }
  }

  return { ...flags, _: positional }
}

/**
 * Run yarn content:generate to validate the newly created file.
 * @returns {void}
 */
function validateWithContentlayer() {
  const result = spawnSync('yarn', ['content:generate'], {
    stdio: 'inherit',
    shell: false,
  })

  if (result.status !== 0) {
    throw new Error('yarn content:generate 验证失败')
  }
}

/**
 * Create a new blog post file.
 * @param {BlogOptions} options
 * @returns {{ filePath: string }}
 */
export function createBlogPost(options) {
  const locale = options.locale
  const title = options.title

  if (!VALID_LOCALES.includes(locale)) {
    throw new Error(`--locale 必须是 ${VALID_LOCALES.join(' 或 ')}`)
  }

  if (!title || title.trim() === '') {
    throw new Error('--title 不能为空')
  }

  const slug = resolveSlug(options.slug, title)
  const folder = resolveFolder(options.folder)
  const filePath = path.join('content', 'blog', locale, folder, `${slug}.md`)

  if (fs.existsSync(filePath)) {
    throw new Error(`文件已存在: ${filePath}`)
  }

  const frontmatter = buildFrontmatter(options)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, frontmatter + '\n', 'utf8')

  return { filePath }
}

/**
 * Execute the create subcommand from parsed CLI arguments.
 * @param {{ [key: string]: string | boolean | string[] | undefined; _: string[] }} args
 * @returns {void}
 */
function runCreate(args) {
  const locale = String(args.locale || 'zh')
  const title = String(args.title || '')
  const slug = args.slug ? String(args.slug) : undefined
  const folder = args.folder ? String(args.folder) : undefined
  const date = String(args.date || new Date().toISOString().split('T')[0])
  const summary = args.summary ? String(args.summary) : undefined
  const categories = parseList(args.categories ? String(args.categories) : undefined)
  const tags = parseList(args.tags ? String(args.tags) : undefined)
  const translationKey = args.translationKey ? String(args.translationKey) : undefined
  const authors = parseList(args.authors ? String(args.authors) : undefined)
  const image = args.image ? String(args.image) : undefined
  const draft = args.draft === true || args.draft === 'true'

  const result = createBlogPost({
    title,
    locale,
    slug,
    folder,
    date,
    summary,
    categories,
    tags,
    translationKey,
    authors: authors.length > 0 ? authors : ['default'],
    image,
    draft,
  })

  console.log(`已创建: ${result.filePath}`)
  console.log('正在运行 yarn content:generate 验证...')
  validateWithContentlayer()
  console.log('验证通过。')
}

function printUsage() {
  console.log(`用法:
  yarn write-blog create --title "文章标题" --locale zh [选项]

选项:
  --title          文章标题（必填）
  --locale         语言，zh 或 en（必填）
  --slug           URL slug；中文标题必须显式提供
  --folder         主题子目录，kebab-case 段，可用 / 嵌套
  --date           发布日期，默认今天（YYYY-MM-DD）
  --summary        摘要
  --categories     分类列表，逗号分隔
  --tags           标签列表，逗号分隔
  --translationKey 多语言关联键
  --authors        作者 ID 列表，逗号分隔，默认 default
  --image          文章主图路径
  --draft          标记为草稿
`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]

  if (command !== 'create') {
    printUsage()
    process.exit(1)
  }

  try {
    runCreate(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`错误: ${message}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
