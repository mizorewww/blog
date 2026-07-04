import { execFileSync } from 'node:child_process'

let warnedOnGitFailure = false

/**
 * Run a git command and return its trimmed stdout.
 *
 * Returns an empty string on failure so callers can fall back gracefully.
 * The first failure logs a warning so silent degradation of git-derived
 * metadata (commit hash, article history) is visible during builds.
 *
 * @param {string[]} args
 * @returns {string}
 */
export function getGitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (error) {
    if (!warnedOnGitFailure) {
      warnedOnGitFailure = true
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `git command failed (git ${args.join(' ')}): ${message}. Git-derived fields will be empty.`
      )
    }
    return ''
  }
}
