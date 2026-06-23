import { createHash } from 'node:crypto'
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
import path from 'node:path'
import { run } from './process.mjs'

const caddyVersion = '2.11.4'
const caddyReleaseTag = `v${caddyVersion}`
const caddyReleaseBaseUrl = `https://github.com/caddyserver/caddy/releases/download/${caddyReleaseTag}`
const caddyBinaryName = process.platform === 'win32' ? 'caddy.exe' : 'caddy'
const caddyAssets = {
  linux_amd64: {
    name: 'caddy_2.11.4_linux_amd64.tar.gz',
    sha512:
      '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9',
  },
  linux_arm64: {
    name: 'caddy_2.11.4_linux_arm64.tar.gz',
    sha512:
      'd5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c',
  },
  mac_amd64: {
    name: 'caddy_2.11.4_mac_amd64.tar.gz',
    sha512:
      'e04eb10f9ce7e2e079bc9bff1bd5d3a3164888d1edbb1a49e5d15be4eab691b57e89ed36bb29c65ba43f1ba8d9279e0967b1003991c13fe4cb78384c3caf25de',
  },
  mac_arm64: {
    name: 'caddy_2.11.4_mac_arm64.tar.gz',
    sha512:
      '3190ae0df98b59ab4b6021556fa35adc3c526a4f3e138776b0eaec8a037cc26121cbbb1ad53453f565551b47d37d5ba4755e2c2c3652256737fe2ce9e53c8ec0',
  },
  windows_amd64: {
    name: 'caddy_2.11.4_windows_amd64.zip',
    sha512:
      'cd5ccfd86a4b40732cf715890d0dca5bf3f63adefec5a7914de85adf240c60ce7e5d2791631b88ef9758e46b23bb1730e020b9c5d696889740b284ffd4788e35',
  },
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

function getCaddyAsset() {
  const platform = getCaddyPlatform()
  const architecture = getCaddyArch()
  const key = `${platform}_${architecture}`
  const asset = caddyAssets[key]

  if (!asset) {
    throw new Error(`No pinned Caddy asset found for ${key}`)
  }

  return { platform, architecture, ...asset }
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

  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
}

async function verifySha512(filePath, expectedSha512) {
  const file = await readFile(filePath)
  const actualSha512 = createHash('sha512').update(file).digest('hex')

  if (actualSha512 !== expectedSha512) {
    throw new Error(
      `Checksum mismatch for ${path.basename(filePath)}: expected ${expectedSha512}, got ${actualSha512}`
    )
  }
}

async function readInstalledCaddyVersion(toolsDir) {
  const versionPath = path.join(toolsDir, 'VERSION')
  const contents = await readFile(versionPath, 'utf8').catch(() => '')
  const [version, assetName, sha512] = contents.trim().split('\n')

  return { version, assetName, sha512 }
}

async function downloadCaddy({ caddyBinaryPath, downloadDir, projectRoot, toolsDir }) {
  await mkdir(toolsDir, { recursive: true })
  await rm(downloadDir, { recursive: true, force: true })
  await mkdir(downloadDir, { recursive: true })

  const asset = getCaddyAsset()
  const archivePath = path.join(downloadDir, asset.name)
  console.log(`Downloading Caddy ${caddyReleaseTag} for ${asset.platform}/${asset.architecture}...`)
  await downloadFile(`${caddyReleaseBaseUrl}/${asset.name}`, archivePath)
  await verifySha512(archivePath, asset.sha512)
  await run('tar', ['-xf', archivePath, '-C', downloadDir], { cwd: projectRoot, env: process.env })

  const extractedBinary = await findFile(downloadDir, caddyBinaryName)

  if (!extractedBinary) {
    throw new Error(`Downloaded archive did not contain ${caddyBinaryName}`)
  }

  await copyFile(extractedBinary, caddyBinaryPath)

  if (process.platform !== 'win32') {
    await chmod(caddyBinaryPath, 0o755)
  }

  await writeFile(
    path.join(toolsDir, 'VERSION'),
    `${caddyReleaseTag}\n${asset.name}\n${asset.sha512}\n`
  )
  await rm(downloadDir, { recursive: true, force: true })
}

export function getCaddyPaths(projectRoot) {
  const toolsDir = path.join(projectRoot, '.tools', 'caddy')

  return {
    caddyBinaryPath: path.join(toolsDir, caddyBinaryName),
    caddyXdgConfigDir: path.join(toolsDir, 'xdg', 'config'),
    caddyXdgDataDir: path.join(toolsDir, 'xdg', 'data'),
    downloadDir: path.join(toolsDir, 'download'),
    toolsDir,
  }
}

export async function ensureCaddy({ projectRoot, updateCaddy }) {
  const paths = getCaddyPaths(projectRoot)
  const asset = getCaddyAsset()

  if (updateCaddy) {
    await rm(paths.caddyBinaryPath, { force: true })
  }

  if (await exists(paths.caddyBinaryPath)) {
    const installed = await readInstalledCaddyVersion(paths.toolsDir)

    if (
      installed.version === caddyReleaseTag &&
      installed.assetName === asset.name &&
      installed.sha512 === asset.sha512
    ) {
      return paths
    }

    await rm(paths.caddyBinaryPath, { force: true })
  }

  await downloadCaddy({ ...paths, projectRoot })
  return paths
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

export async function writeCaddyfile({ port, projectRoot, toolsDir }) {
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
\tadmin off
\tauto_https off
}

:${port} {
\troot * ${quoteCaddyfileValue(outDir)}
\tencode zstd gzip
${redirectsBlock}
\tfile_server

\thandle_errors {
\t\trewrite * /404/index.html
\t\tfile_server
\t}
}
`

  await writeFile(caddyfilePath, caddyfile)
  return caddyfilePath
}
