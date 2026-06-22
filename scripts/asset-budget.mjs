import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const targetDir = process.argv[2] || 'out'
const budgets = {
  imageMaxBytes: 900 * 1024,
  imagesTotalBytes: 2 * 1024 * 1024,
  jsMaxBytes: 350 * 1024,
  cssMaxBytes: 150 * 1024,
}

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])

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

    if (!entry.isFile()) {
      continue
    }

    const fileStat = await stat(entryPath)
    files.push({
      path: entryPath,
      size: fileStat.size,
      ext: path.extname(entry.name).toLowerCase(),
    })
  }

  return files
}

const files = await collectFiles(targetDir)
const failures = []
const imageFiles = files.filter((file) => imageExtensions.has(file.ext))
const imagesTotal = imageFiles.reduce((total, file) => total + file.size, 0)

for (const file of imageFiles) {
  if (file.size > budgets.imageMaxBytes) {
    failures.push(
      `${file.path} is ${formatBytes(file.size)}; image budget is ${formatBytes(budgets.imageMaxBytes)}`
    )
  }
}

if (imagesTotal > budgets.imagesTotalBytes) {
  failures.push(
    `Total image weight is ${formatBytes(imagesTotal)}; budget is ${formatBytes(budgets.imagesTotalBytes)}`
  )
}

for (const file of files.filter((candidate) => candidate.ext === '.js')) {
  if (file.size > budgets.jsMaxBytes) {
    failures.push(
      `${file.path} is ${formatBytes(file.size)}; JS asset budget is ${formatBytes(budgets.jsMaxBytes)}`
    )
  }
}

for (const file of files.filter((candidate) => candidate.ext === '.css')) {
  if (file.size > budgets.cssMaxBytes) {
    failures.push(
      `${file.path} is ${formatBytes(file.size)}; CSS asset budget is ${formatBytes(budgets.cssMaxBytes)}`
    )
  }
}

if (failures.length > 0) {
  console.error('Asset budget failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Asset budget passed')
