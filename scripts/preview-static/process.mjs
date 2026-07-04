import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const previewReminderIntervalMs = 30000

/**
 * @param {string} command - executable to spawn
 * @param {string[]} commandArgs - arguments forwarded to the executable
 * @param {import('node:child_process').SpawnOptions} [options] - spawn options
 * @returns {Promise<void>}
 */
export function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      ...options,
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve(undefined)
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

/**
 * @param {string} port - preview port
 * @returns {string[]}
 */
export function getNetworkUrls(port) {
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

/**
 * @param {string} prefix - heading printed before the url list
 * @param {string[]} urls - urls to print
 */
export function printPreviewUrls(prefix, urls) {
  console.log(`\n${prefix}`)
  urls.forEach((url, index) => {
    const label = index === 0 ? 'Local' : 'Network'
    console.log(`  ${label}: ${url}`)
  })
  console.log('  Stop:  Ctrl+C\n')
}

/**
 * @param {string} command - executable to spawn
 * @param {string[]} commandArgs - arguments forwarded to the executable
 * @param {string[]} urls - urls printed in reminders
 * @param {import('node:child_process').SpawnOptions} [options] - spawn options
 * @returns {Promise<void>}
 */
export function runWithPreviewReminders(command, commandArgs, urls, options = {}) {
  return new Promise((resolve, reject) => {
    printPreviewUrls('Static preview is running:', urls)

    const reminder = setInterval(() => {
      printPreviewUrls('Static preview still running:', urls)
    }, previewReminderIntervalMs)

    const child = spawn(command, commandArgs, {
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
        resolve(undefined)
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
