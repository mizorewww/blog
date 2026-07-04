import { spawn } from 'node:child_process'

const maxTimeoutSeconds = 1800
const defaultTimeoutSeconds = 1800
const defaultHeartbeatSeconds = 60
const args = process.argv.slice(2)

/**
 * @param {string} name - option flag name
 * @param {string} fallback - value to return when the option is absent
 * @returns {string}
 */
function readOption(name, fallback) {
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`))
  if (withEquals) return withEquals.slice(name.length + 1)

  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

function readCommand() {
  const separator = args.indexOf('--')
  if (separator === -1) return []
  return args.slice(separator + 1)
}

/**
 * @param {string} name - option flag name
 * @param {number} fallback - value to return when the option is absent
 * @returns {number}
 */
function readPositiveInteger(name, fallback) {
  const rawValue = readOption(name, String(fallback))
  const parsed = Number.parseInt(rawValue, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return parsed
}

const requestedTimeoutSeconds = readPositiveInteger('--timeout-seconds', defaultTimeoutSeconds)
const timeoutSeconds = Math.min(requestedTimeoutSeconds, maxTimeoutSeconds)
const heartbeatSeconds = readPositiveInteger('--heartbeat-seconds', defaultHeartbeatSeconds)
const label = readOption('--label', 'agent-task')
const command = readCommand()

if (command.length === 0) {
  console.error(
    'Usage: yarn agent:watchdog --label <name> --timeout-seconds 1800 -- <command> [args...]'
  )
  process.exit(2)
}

if (requestedTimeoutSeconds > maxTimeoutSeconds) {
  console.error(
    `AGENT_WATCHDOG_CONFIG: requested timeout ${requestedTimeoutSeconds}s capped at ${maxTimeoutSeconds}s`
  )
}

const startedAt = Date.now()
const [executable, ...commandArgs] = command
let timedOut = false
/** @type {NodeJS.Timeout | null} */
let forceKillTimeout = null
const child = spawn(executable, commandArgs, {
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

console.error(
  `AGENT_WATCHDOG_START: label=${label} pid=${child.pid ?? 'unknown'} timeout_seconds=${timeoutSeconds}`
)

const heartbeat = setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
  console.error(`AGENT_WATCHDOG_HEARTBEAT: label=${label} elapsed_seconds=${elapsedSeconds}`)
}, heartbeatSeconds * 1000)

const timeout = setTimeout(() => {
  timedOut = true
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
  console.error(`AGENT_WATCHDOG_TIMEOUT: label=${label} elapsed_seconds=${elapsedSeconds}`)
  child.kill('SIGTERM')
  forceKillTimeout = setTimeout(() => {
    console.error(`AGENT_WATCHDOG_FORCE_KILL: label=${label}`)
    child.kill('SIGKILL')
  }, 5000)
}, timeoutSeconds * 1000)

/** @type {NodeJS.Signals[]} */
const forwardedSignals = ['SIGINT', 'SIGTERM']

for (const signal of forwardedSignals) {
  process.on(signal, () => {
    child.kill(signal)
  })
}

child.on('error', (error) => {
  clearInterval(heartbeat)
  clearTimeout(timeout)
  if (forceKillTimeout) clearTimeout(forceKillTimeout)
  console.error(`AGENT_WATCHDOG_ERROR: label=${label} message=${error.message}`)
  process.exit(1)
})

child.on('close', (code, signal) => {
  clearInterval(heartbeat)
  clearTimeout(timeout)
  if (forceKillTimeout) clearTimeout(forceKillTimeout)

  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
  if (signal) {
    console.error(
      `AGENT_WATCHDOG_EXIT: label=${label} elapsed_seconds=${elapsedSeconds} signal=${signal}`
    )
    process.exit(timedOut ? 124 : 1)
  }

  console.error(
    `AGENT_WATCHDOG_EXIT: label=${label} elapsed_seconds=${elapsedSeconds} code=${code ?? 1}`
  )
  process.exit(code ?? 1)
})
