import { rm } from 'node:fs/promises'

const outputDirs = ['.next', 'out']

await Promise.all(outputDirs.map((dir) => rm(dir, { recursive: true, force: true })))
