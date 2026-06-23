import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectFiles, formatBytes } from '../../scripts/lib/file-utils.mjs'

type CollectedFile = {
  path: string
  size: number
}

describe('script file utilities', () => {
  it('formats bytes consistently', () => {
    expect(formatBytes(42)).toBe('42 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB')
  })

  it('collects files recursively with an extension filter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'blog-file-utils-'))

    try {
      await mkdir(path.join(root, 'nested'))
      await writeFile(path.join(root, 'a.js'), 'a')
      await writeFile(path.join(root, 'nested', 'b.css'), 'bb')
      await writeFile(path.join(root, 'nested', 'c.txt'), 'ccc')

      const files = (await collectFiles(root, {
        extensions: new Set(['.js', '.css']),
      })) as CollectedFile[]

      expect(files.map((file) => path.basename(file.path)).sort()).toEqual(['a.js', 'b.css'])
      expect(files.map((file) => file.size).sort()).toEqual([1, 2])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
