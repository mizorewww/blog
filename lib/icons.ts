import { generatedLucideIcons } from './generated/lucide-icons'
import { iconAliases } from './iconAliases'
import { normalizeIconKey, pascalizeKey } from './iconName'

export { iconAliases }

export function toIconComponentName(value: string) {
  const key = normalizeIconKey(value)

  if (!key) {
    return 'CircleHelp'
  }

  const alias = iconAliases[key]

  if (alias) {
    return alias
  }

  return pascalizeKey(key)
}

export function getIconComponent(value: string) {
  const componentName = toIconComponentName(value)

  return generatedLucideIcons[componentName] || generatedLucideIcons.CircleHelp
}
