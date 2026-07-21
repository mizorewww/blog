/**
 * @typedef {{ source: string, destination: string, statusCode: number }} RedirectRule
 */

/**
 * @param {string} redirects - _redirects file contents
 * @returns {RedirectRule[]}
 */
export function parseRedirects(redirects) {
  return redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .flatMap((line) => {
      const [source, destination, status = '302'] = line.split(/\s+/)

      if (!source || !destination) {
        return []
      }

      return [{ source, destination, statusCode: Number(status) }]
    })
}

/**
 * @param {string} value - redirect path pattern
 * @returns {string}
 */
function toNextPattern(value) {
  return value.replace(/:splat(?!\*)|\*/g, ':splat*')
}

/**
 * @param {RedirectRule[]} rules - normalized redirect rules
 * @returns {Array<{ source: string, destination: string, statusCode: number }>}
 */
export function toNextRedirects(rules) {
  return rules.flatMap(({ source, destination, statusCode }) => {
    const redirect = {
      source: toNextPattern(source),
      destination: toNextPattern(destination),
      statusCode,
    }

    if (!source.endsWith('*') || !destination.includes(':splat')) {
      return [redirect]
    }

    return [
      {
        ...redirect,
        source: `${redirect.source}/`,
        destination: redirect.destination.replaceAll(':splat*', ':splat*/'),
      },
      redirect,
    ]
  })
}

/**
 * @param {string} value - value to escape
 * @returns {string}
 */
function escapeCaddyRegexp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} source - redirect source pattern
 * @param {string} name - matcher name
 * @returns {{ directive: string, matcher: string }}
 */
function createCaddyRedirectMatcher(source, name) {
  if (!source.includes('*')) {
    return {
      directive: '',
      matcher: source,
    }
  }

  return {
    directive: `\t@${name} path_regexp ${name} ^${source
      .split('*')
      .map(escapeCaddyRegexp)
      .join('(.*)')}$`,
    matcher: `@${name}`,
  }
}

/**
 * @param {RedirectRule[]} rules - normalized redirect rules
 * @returns {string[]}
 */
export function toCaddyRedirectDirectives(rules) {
  return rules.flatMap(({ source, destination, statusCode }, index) => {
    const name = `redirect_${index}`
    const { directive, matcher } = createCaddyRedirectMatcher(source, name)

    if (source.endsWith('/*') && destination.endsWith('/:splat')) {
      const sourcePrefix = source.slice(0, -2)
      const destinationPrefix = destination.slice(0, -7)

      return [
        directive,
        `\troute ${matcher} {`,
        `\t\turi strip_prefix ${sourcePrefix}`,
        '\t\theader >Location "%2F" "/"',
        `\t\tredir * ${destinationPrefix}{%path} ${statusCode}`,
        '\t}',
      ]
    }

    const target = destination.replaceAll(':splat', `{re.${name}.1}`)

    return [directive, `\tredir ${matcher} ${target} ${statusCode}`].filter(Boolean)
  })
}
