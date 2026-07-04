/**
 * Shared icon-name normalization used by both the runtime icon resolver
 * (`lib/icons.ts`) and the build-time icon registry generator
 * (`scripts/generate-lucide-icons.mjs`). Keeping one source prevents drift
 * between the generated registry and runtime lookups.
 */

export function normalizeIconKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export function pascalizeKey(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
}
