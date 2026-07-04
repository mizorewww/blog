import { readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { formatBytes } from './lib/file-utils.mjs'

const imageDir = path.join('public', 'static', 'images')
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png'])

const IMAGE_OPTIMIZATION_PRESETS = {
  maxPhotoWidth: 2000,
  maxRasterWidth: 1600,
  jpegQuality: 82,
  pngCompressionLevel: 9,
}

async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const before = (await stat(filePath)).size
  const tempPath = `${filePath}.tmp`
  let pipeline = sharp(filePath).rotate()

  if (ext === '.jpg' || ext === '.jpeg') {
    pipeline = pipeline
      .resize({ width: IMAGE_OPTIMIZATION_PRESETS.maxPhotoWidth, withoutEnlargement: true })
      .jpeg({ quality: IMAGE_OPTIMIZATION_PRESETS.jpegQuality, mozjpeg: true })
  } else if (ext === '.png') {
    pipeline = pipeline
      .resize({ width: IMAGE_OPTIMIZATION_PRESETS.maxRasterWidth, withoutEnlargement: true })
      .png({
        compressionLevel: IMAGE_OPTIMIZATION_PRESETS.pngCompressionLevel,
        adaptiveFiltering: true,
      })
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

const failures = []

for (const entry of await readdir(imageDir, { withFileTypes: true })) {
  if (!entry.isFile()) {
    continue
  }

  const filePath = path.join(imageDir, entry.name)

  if (!supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
    continue
  }

  try {
    await optimizeImage(filePath)
  } catch (error) {
    failures.push({ filePath, message: error instanceof Error ? error.message : String(error) })
    console.error(`failed    ${filePath}: ${failures[failures.length - 1].message}`)
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} image(s) failed to optimize:`)
  for (const failure of failures) {
    console.error(`  ${failure.filePath}: ${failure.message}`)
  }
  process.exit(1)
}
