import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsDir = path.join(projectRoot, '.tools', 'caddy')
const downloadDir = path.join(toolsDir, 'download')
const caddyXdgConfigDir = path.join(toolsDir, 'xdg', 'config')
const caddyXdgDataDir = path.join(toolsDir, 'xdg', 'data')
const caddyBinaryName = process.platform === 'win32' ? 'caddy.exe' : 'caddy'
const caddyBinaryPath = path.join(toolsDir, caddyBinaryName)
const caddyReleaseApi = 'https://api.github.com/repos/caddyserver/caddy/releases/latest'
const defaultPort = '3001'
const previewReminderIntervalMs = 30000

const rawArgs = process.argv.slice(2)
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
const port = readArg('--port') || process.env.PORT || defaultPort
const skipBuild = args.includes('--no-build')
const updateCaddy = args.includes('--update-caddy')

function readArg(name) {
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`))

  if (withEquals) {
    return withEquals.slice(name.length + 1)
  }

  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      ...options,
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `${command} ${commandArgs.join(' ')} exited with signal ${signal}`
            : `${command} ${commandArgs.join(' ')} exited with code ${code}`
        )
      )
    })
  })
}

function getNetworkUrls() {
  const urls = [`http://localhost:${port}/`]
  const interfaces = networkInterfaces()
  const virtualInterfacePattern =
    /^(br-|docker|lo|singtun|tap|tun|utun|vboxnet|veth|virbr|vmnet|wg)/i

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (virtualInterfacePattern.test(name)) {
      continue
    }

    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}/`)
      }
    }
  }

  return [...new Set(urls)]
}

function printPreviewUrls(prefix, urls) {
  console.log(`\n${prefix}`)
  urls.forEach((url, index) => {
    const label = index === 0 ? 'Local' : 'Network'
    console.log(`  ${label}: ${url}`)
  })
  console.log('  Stop:  Ctrl+C\n')
}

function runWithPreviewReminders(command, commandArgs, urls, options = {}) {
  return new Promise((resolve, reject) => {
    printPreviewUrls('Static preview is running:', urls)

    const reminder = setInterval(() => {
      printPreviewUrls('Static preview still running:', urls)
    }, previewReminderIntervalMs)

    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
      ...options,
    })

    child.on('error', (error) => {
      clearInterval(reminder)
      reject(error)
    })

    child.on('close', (code, signal) => {
      clearInterval(reminder)

      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `${command} ${commandArgs.join(' ')} exited with signal ${signal}`
            : `${command} ${commandArgs.join(' ')} exited with code ${code}`
        )
      )
    })
  })
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findFile(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      const found = await findFile(entryPath, fileName)

      if (found) {
        return found
      }
    }

    if (entry.isFile() && entry.name === fileName) {
      return entryPath
    }
  }

  return null
}

function getCaddyPlatform() {
  const platforms = {
    darwin: 'mac',
    linux: 'linux',
    win32: 'windows',
  }

  const platform = platforms[process.platform]

  if (!platform) {
    throw new Error(`Unsupported platform for Caddy download: ${process.platform}`)
  }

  return platform
}

function getCaddyArch() {
  const architectures = {
    arm64: 'arm64',
    x64: 'amd64',
  }

  const architecture = architectures[process.arch]

  if (!architecture) {
    throw new Error(`Unsupported architecture for Caddy download: ${process.arch}`)
  }

  return architecture
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mizore-blog-caddy-preview',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'mizore-blog-caddy-preview',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath))
}

async function downloadCaddy() {
  await mkdir(toolsDir, { recursive: true })
  await rm(downloadDir, { recursive: true, force: true })
  await mkdir(downloadDir, { recursive: true })

  const platform = getCaddyPlatform()
  const architecture = getCaddyArch()
  const archiveExtension = platform === 'windows' ? '.zip' : '.tar.gz'
  const release = await fetchJson(caddyReleaseApi)
  const asset = release.assets?.find((candidate) => {
    const name = candidate.name || ''
    return name.includes(`_${platform}_${architecture}`) && name.endsWith(archiveExtension)
  })

  if (!asset?.browser_download_url) {
    throw new Error(`No Caddy asset found for ${platform}_${architecture}`)
  }

  const archivePath = path.join(downloadDir, asset.name)
  console.log(`Downloading Caddy ${release.tag_name} for ${platform}/${architecture}...`)
  await downloadFile(asset.browser_download_url, archivePath)
  await run('tar', ['-xf', archivePath, '-C', downloadDir])

  const extractedBinary = await findFile(downloadDir, caddyBinaryName)

  if (!extractedBinary) {
    throw new Error(`Downloaded archive did not contain ${caddyBinaryName}`)
  }

  await copyFile(extractedBinary, caddyBinaryPath)

  if (process.platform !== 'win32') {
    await chmod(caddyBinaryPath, 0o755)
  }

  await writeFile(path.join(toolsDir, 'VERSION'), `${release.tag_name}\n${asset.name}\n`)
  await rm(downloadDir, { recursive: true, force: true })
}

async function ensureCaddy() {
  if (updateCaddy) {
    await rm(caddyBinaryPath, { force: true })
  }

  if (await exists(caddyBinaryPath)) {
    return
  }

  await downloadCaddy()
}

async function buildStaticSite() {
  if (skipBuild) {
    return
  }

  const yarnPath = path.join(projectRoot, '.yarn', 'releases', 'yarn-3.6.1.cjs')

  if (await exists(yarnPath)) {
    await run(process.execPath, [yarnPath, 'build'])
    return
  }

  await run('yarn', ['build'])
}

function quoteCaddyfileValue(value) {
  return JSON.stringify(value)
}

function escapeCaddyRegexp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function createRedirectMatcher(source, name) {
  if (!source.includes('*')) {
    return {
      directive: '',
      matcher: source,
    }
  }

  return {
    directive: `\t@${name} path_regexp ${name} ^${source.split('*').map(escapeCaddyRegexp).join('(.*)')}$`,
    matcher: `@${name}`,
  }
}

async function readRedirectDirectives(outDir) {
  const redirects = await readFile(path.join(outDir, '_redirects'), 'utf8').catch(() => '')

  return redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .flatMap((line, index) => {
      const [source, destination, status = '302'] = line.split(/\s+/)

      if (!source || !destination) {
        return []
      }

      const name = `redirect_${index}`
      const { directive, matcher } = createRedirectMatcher(source, name)
      const target = destination.replaceAll(':splat', `{re.${name}.1}`)

      return [directive, `\tredir ${matcher} ${target} ${status}`].filter(Boolean)
    })
}

async function writeCaddyfile() {
  const outDir = path.join(projectRoot, 'out')
  const outStats = await stat(outDir).catch(() => null)

  if (!outStats?.isDirectory()) {
    throw new Error('Static output directory does not exist: out/')
  }

  const caddyfilePath = path.join(
    toolsDir,
    `Caddyfile.preview-${port.replaceAll(/[^0-9A-Za-z_-]/g, '_')}`
  )
  const redirectDirectives = await readRedirectDirectives(outDir)
  const redirectsBlock = redirectDirectives.length > 0 ? `${redirectDirectives.join('\n')}\n` : ''
  const caddyfile = `{
	admin off
	auto_https off
}

:${port} {
	root * ${quoteCaddyfileValue(outDir)}
	encode zstd gzip
${redirectsBlock}
	file_server

	handle_errors {
		rewrite * /404/index.html
		file_server
	}
}
`

  await writeFile(caddyfilePath, caddyfile)
  return caddyfilePath
}

await buildStaticSite()
await ensureCaddy()

const caddyfilePath = await writeCaddyfile()
const previewUrls = getNetworkUrls()
await mkdir(caddyXdgConfigDir, { recursive: true })
await mkdir(caddyXdgDataDir, { recursive: true })
await runWithPreviewReminders(
  caddyBinaryPath,
  ['run', '--config', caddyfilePath, '--adapter', 'caddyfile'],
  previewUrls,
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: caddyXdgConfigDir,
      XDG_DATA_HOME: caddyXdgDataDir,
    },
  }
)
