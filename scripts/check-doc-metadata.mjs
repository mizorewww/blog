import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const governedRoots = [
  'AGENTS.md',
  'AI_CODE_QUALITY.md',
  'QUALITY_GATES.md',
  'CODEX_WORKFLOW.md',
  'docs',
  path.join('.agents', 'skills', 'codex-agent-workflow'),
]

const requiredScalars = [
  'status',
  'audience',
  'authority',
  'owner',
  'last_verified',
  'verified_by',
  'supersedes',
  'superseded_by',
]

const requiredLists = ['related_code', 'update_when']

const allowedValues = {
  status: new Set(['active', 'draft', 'deprecated', 'superseded']),
  audience: new Set(['human', 'agent', 'both']),
  authority: new Set(['source-of-truth', 'guide', 'note', 'research']),
  verified_by: new Set(['command', 'agent review', 'source citation']),
}

/**
 * @param {string} target - path relative to repo root
 * @returns {string[]}
 */
function listMarkdownFiles(target) {
  const absolute = path.join(root, target)
  if (!fs.existsSync(absolute)) return []
  const stats = fs.statSync(absolute)
  if (stats.isFile()) return target.endsWith('.md') ? [target] : []

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(child)
    return entry.isFile() && child.endsWith('.md') ? [child] : []
  })
}

/**
 * @param {string} filePath - path relative to repo root
 * @param {string} text - file contents
 */
function parseFrontMatter(filePath, text) {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 4)
  if (end === -1) return null

  /** @type {Record<string, string | string[]>} */
  const metadata = {}
  let currentListKey = null
  const body = text.slice(4, end).split('\n')

  for (const line of body) {
    const keyMatch = line.match(/^([a-z_]+):(?:\s*(.*))?$/)
    if (keyMatch) {
      const [, key, rawValue = ''] = keyMatch
      const value = rawValue.trim()
      metadata[key] = value
      currentListKey = requiredLists.includes(key) ? key : null
      if (currentListKey) metadata[currentListKey] = []
      continue
    }

    const listMatch = line.match(/^\s+-\s+(.+)$/)
    if (listMatch && currentListKey) {
      const currentList = /** @type {string[]} */ (metadata[currentListKey])
      currentList.push(listMatch[1].trim())
    }
  }

  return { filePath, metadata }
}

const files = governedRoots.flatMap(listMarkdownFiles)
const failures = []

for (const filePath of files) {
  const text = fs.readFileSync(path.join(root, filePath), 'utf8')
  const parsed = parseFrontMatter(filePath, text)

  if (!parsed) {
    failures.push(`${filePath}: missing front matter`)
    continue
  }

  const { metadata } = parsed

  for (const key of requiredScalars) {
    if (!(key in metadata)) failures.push(`${filePath}: missing ${key}`)
  }

  for (const key of requiredLists) {
    if (!Array.isArray(metadata[key]) || metadata[key].length === 0) {
      failures.push(`${filePath}: missing ${key} list`)
    }
  }

  for (const [key, values] of Object.entries(allowedValues)) {
    if (metadata[key] && !values.has(/** @type {string} */ (metadata[key]))) {
      failures.push(`${filePath}: invalid ${key} "${metadata[key]}"`)
    }
  }

  if (
    metadata.last_verified &&
    !/^\d{4}-\d{2}-\d{2}$/.test(/** @type {string} */ (metadata.last_verified))
  ) {
    failures.push(`${filePath}: last_verified must be YYYY-MM-DD`)
  }
}

if (failures.length > 0) {
  console.error('DOC_METADATA_RESULT: FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('DOC_METADATA_RESULT: PASS')
console.log(`checked_files: ${files.length}`)
