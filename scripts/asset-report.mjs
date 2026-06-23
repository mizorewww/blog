import { collectFiles, formatBytes } from './lib/file-utils.mjs'

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

const files = (await collectFiles(targetDir, { extensions: trackedExtensions })).sort(
  (a, b) => b.size - a.size
)

for (const file of files.slice(0, 50)) {
  console.log(`${formatBytes(file.size).padStart(10)}  ${file.path}`)
}
