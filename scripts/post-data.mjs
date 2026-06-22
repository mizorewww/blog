import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { allBlogs } from '../.contentlayer/generated/index.mjs'

const outputFolder = 'out'
const postDataFolder = '_post-data'

function writePostData(post) {
  const outputPath = path.join(outputFolder, postDataFolder, `${post.path}.json`)

  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(
    outputPath,
    JSON.stringify({
      bodyCode: post.body.code,
    })
  )
}

function isPublishedPost(post) {
  return !('draft' in post) || post.draft !== true
}

export default function postData() {
  allBlogs.filter(isPublishedPost).forEach(writePostData)
  console.log('Post preload data generated...')
}
