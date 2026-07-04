import { collectFiles, formatBytes } from './lib/file-utils.mjs'
import path from 'node:path'

const targetDir = process.argv[2] || 'out'
const budgets = {
  imageMaxBytes: 900 * 1024,
  imagesTotalBytes: 2 * 1024 * 1024,
  jsMaxBytes: 350 * 1024,
  cssMaxBytes: 150 * 1024,
}

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif'])

const files = (await collectFiles(targetDir)).filter(
  (file) => !file.path.includes(`${path.sep}pagefind${path.sep}`)
)
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
