import { generatedLucideIcons } from './generated/lucide-icons'
import { iconAliases } from './iconAliases'

export { iconAliases }

export function toIconComponentName(value: string) {
  const key = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  if (!key) {
    return 'CircleHelp'
  }

  const alias = iconAliases[key]

  if (alias) {
    return alias
  }

  return key
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
}

export function getIconComponent(value: string) {
  const componentName = toIconComponentName(value)

  return generatedLucideIcons[componentName] || generatedLucideIcons.CircleHelp
}
