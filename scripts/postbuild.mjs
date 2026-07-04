import rss from './rss.mjs'
import { execSync } from 'node:child_process'

async function searchIndex() {
  try {
    execSync('pagefind --site out', { stdio: 'inherit', cwd: process.cwd() })
    console.log('Pagefind search index generated...')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Pagefind index generation failed:', message)
    throw error
  }
}

async function postbuild() {
  await rss()
  await searchIndex()
}

postbuild()
