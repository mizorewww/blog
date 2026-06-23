import { readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { formatBytes } from './lib/file-utils.mjs'

const imageDir = path.join('public', 'static', 'images')
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png'])
const maxPhotoWidth = 2000

async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const before = (await stat(filePath)).size
  const tempPath = `${filePath}.tmp`
  let pipeline = sharp(filePath).rotate()

  if (ext === '.jpg' || ext === '.jpeg') {
    pipeline = pipeline
      .resize({ width: maxPhotoWidth, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
  } else if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  }

  await pipeline.toFile(tempPath)

  const after = (await stat(tempPath)).size

  if (after >= before) {
    await rm(tempPath, { force: true })
    console.log(`kept      ${formatBytes(before).padStart(9)}  ${filePath}`)
    return
  }

  await rename(tempPath, filePath)
  console.log(
    `optimized ${formatBytes(before).padStart(9)} -> ${formatBytes(after).padStart(9)}  ${filePath}`
  )
}

for (const entry of await readdir(imageDir, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue
  }

  const filePath = path.join(imageDir, entry.name)

  if (supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
    await optimizeImage(filePath)
  }
}
