import { existsSync } from 'node:fs'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { formatBytes } from './lib/file-utils.mjs'

const imageDir = path.join('public', 'static', 'images')
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png'])
const checkOnly = process.argv.includes('--check')

const IMAGE_OPTIMIZATION_PRESETS = {
  maxPhotoWidth: 2000,
  maxRasterWidth: 1600,
  jpegQuality: 82,
  pngCompressionLevel: 9,
  webpQuality: 78,
}

// Must match RESPONSIVE_WIDTHS in lib/images.ts so the runtime srcset and the
// generated variant files stay in sync.
const RESPONSIVE_WIDTHS = [400, 640, 768, 1024, 1280]

function variantPath(filePath, width) {
  const ext = path.extname(filePath)
  return `${filePath.slice(0, filePath.length - ext.length)}.${width}.webp`
}

async function optimizeOriginal(filePath) {
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

async function generateVariants(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  if (!supportedExtensions.has(ext)) {
    return
  }

  const meta = await sharp(filePath).metadata()
  const sourceWidth = meta.width || 0

  for (const width of RESPONSIVE_WIDTHS) {
    if (sourceWidth && width > sourceWidth) {
      continue
    }

    const target = variantPath(filePath, width)

    await sharp(filePath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: IMAGE_OPTIMIZATION_PRESETS.webpQuality })
      .toFile(target)
  }
}

async function processImage(filePath) {
  if (checkOnly) {
    const meta = await sharp(filePath).metadata()
    const sourceWidth = meta.width || 0
    const missing = []

    for (const width of RESPONSIVE_WIDTHS) {
      if (sourceWidth && width > sourceWidth) continue
      if (!existsSync(variantPath(filePath, width))) {
        missing.push(variantPath(filePath, width))
      }
    }

    if (missing.length > 0) {
      throw new Error(`missing responsive variants:\n  ${missing.join('\n  ')}`)
    }

    return
  }

  await optimizeOriginal(filePath)
  await generateVariants(filePath)
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
    await processImage(filePath)
  } catch (error) {
    failures.push({ filePath, message: error instanceof Error ? error.message : String(error) })
    console.error(`failed    ${filePath}: ${failures[failures.length - 1].message}`)
  }
}

if (checkOnly) {
  console.log('Responsive image variants are up to date')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} image(s) failed:`)
  for (const failure of failures) {
    console.error(`  ${failure.filePath}: ${failure.message}`)
  }
  process.exit(1)
}
