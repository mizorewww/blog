import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * @param {number} bytes - byte count to format
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * @param {string} dir - directory to scan recursively
 * @param {{ extensions?: Set<string> }} [options] - optional extension filter
 * @returns {Promise<Array<{ path: string, size: number, ext: string }>>}
 */
export async function collectFiles(dir, options = {}) {
  const entries = await readdir(dir, { withFileTypes: true })
  /** @type {Array<{ path: string, size: number, ext: string }>} */
  const files = []
  const extensions = options.extensions || null

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, options)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const ext = path.extname(entry.name).toLowerCase()

    if (extensions && !extensions.has(ext)) {
      continue
    }

    const fileStat = await stat(entryPath)
    files.push({
      path: entryPath,
      size: fileStat.size,
      ext,
    })
  }

  return files
}
