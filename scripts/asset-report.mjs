import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const targetDir = process.argv[2] || 'out'
const trackedExtensions = new Set([
  '.css',
  '.js',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.woff2',
])

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)))
      continue
    }

    if (!entry.isFile() || !trackedExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue
    }

    const fileStat = await stat(entryPath)
    files.push({ path: entryPath, size: fileStat.size })
  }

  return files
}

const files = (await collectFiles(targetDir)).sort((a, b) => b.size - a.size)

for (const file of files.slice(0, 50)) {
  console.log(`${formatBytes(file.size).padStart(10)}  ${file.path}`)
}
