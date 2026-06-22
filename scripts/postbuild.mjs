import rss from './rss.mjs'
import postData from './post-data.mjs'

async function postbuild() {
  await rss()
  await postData()
}

postbuild()
