import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type MdxModuleDoc = {
  body?: {
    code?: string
  }
  _raw: {
    flattenedPath: string
  }
}

const generatedMdxDir = '.contentlayer/generated/mdx'

function mdxModuleFileName(doc: MdxModuleDoc) {
  return `${doc._raw.flattenedPath.replace(/[^a-zA-Z0-9_-]/g, '__')}.mjs`
}

function toMdxModuleSource(code: string) {
  const moduleBody = code.replace(
    /;return Component;\s*$/,
    ';\nexport default Component.default;\n'
  )

  if (moduleBody === code) {
    throw new Error('Unable to convert Contentlayer MDX runtime code into an ESM module')
  }

  return [
    "import React from 'react'",
    "import ReactDOM from 'react-dom'",
    "import * as _jsx_runtime from 'react/jsx-runtime'",
    '',
    moduleBody,
  ].join('\n')
}

export async function writeMdxModule(doc: MdxModuleDoc) {
  const code = doc.body?.code

  if (!code) {
    return ''
  }

  const fileName = mdxModuleFileName(doc)
  const outputDir = path.join(process.cwd(), generatedMdxDir)
  const outputPath = path.join(outputDir, fileName)

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, toMdxModuleSource(code))

  return `${generatedMdxDir}/${fileName}`
}
