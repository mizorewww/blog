import { access, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePreviewArgs } from './preview-static/args.mjs'
import { ensureCaddy, writeCaddyfile } from './preview-static/caddy.mjs'
import { getNetworkUrls, run, runWithPreviewReminders } from './preview-static/process.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { port, skipBuild, updateCaddy } = parsePreviewArgs(process.argv.slice(2))

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function buildStaticSite() {
  if (skipBuild) {
    return
  }

  const yarnPath = path.join(projectRoot, '.yarn', 'releases', 'yarn-3.6.1.cjs')

  if (await exists(yarnPath)) {
    await run(process.execPath, [yarnPath, 'build'], { cwd: projectRoot, env: process.env })
    return
  }

  await run('yarn', ['build'], { cwd: projectRoot, env: process.env })
}

await buildStaticSite()

const caddyPaths = await ensureCaddy({ projectRoot, updateCaddy })
const caddyfilePath = await writeCaddyfile({ port, projectRoot, toolsDir: caddyPaths.toolsDir })
const previewUrls = getNetworkUrls(port)

await mkdir(caddyPaths.caddyXdgConfigDir, { recursive: true })
await mkdir(caddyPaths.caddyXdgDataDir, { recursive: true })
await runWithPreviewReminders(
  caddyPaths.caddyBinaryPath,
  ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'],
  previewUrls,
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: caddyPaths.caddyXdgConfigDir,
      XDG_DATA_HOME: caddyPaths.caddyXdgDataDir,
    },
  }
)
