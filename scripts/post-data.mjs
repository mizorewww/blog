import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
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

export default function postData() {
  allBlogs.filter((post) => post.draft !== true).forEach(writePostData)
  console.log('Post preload data generated...')
}
