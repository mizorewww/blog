import type { BundledTheme } from 'shiki'

type CodeThemePreset = {
  dark: BundledTheme
  description: string
  label: string
  light: BundledTheme
}

export const codeThemePresets = {
  catppuccin: {
    label: 'Catppuccin',
    light: 'catppuccin-latte',
    dark: 'catppuccin-mocha',
    description: 'Warm pastel theme with Latte for light mode and Mocha for dark mode.',
  },
  'catppuccin-macchiato': {
    label: 'Catppuccin Macchiato',
    light: 'catppuccin-latte',
    dark: 'catppuccin-macchiato',
    description: 'A slightly softer Catppuccin dark variant.',
  },
  github: {
    label: 'GitHub',
    light: 'github-light',
    dark: 'github-dark-dimmed',
    description: 'Neutral GitHub-style highlighting.',
  },
  vitesse: {
    label: 'Vitesse',
    light: 'vitesse-light',
    dark: 'vitesse-dark',
    description: 'Clean, low-contrast Vitesse themes.',
  },
  'rose-pine': {
    label: 'Rose Pine',
    light: 'rose-pine-dawn',
    dark: 'rose-pine-moon',
    description: 'Muted editorial colors with a warmer dark theme.',
  },
  gruvbox: {
    label: 'Gruvbox',
    light: 'gruvbox-light-medium',
    dark: 'gruvbox-dark-medium',
    description: 'Retro terminal colors with strong contrast.',
  },
  kanagawa: {
    label: 'Kanagawa',
    light: 'kanagawa-lotus',
    dark: 'kanagawa-wave',
    description: 'Soft Japanese-inspired palette.',
  },
  material: {
    label: 'Material',
    light: 'material-theme-lighter',
    dark: 'material-theme-palenight',
    description: 'Material-style colors with a vivid dark mode.',
  },
  nord: {
    label: 'Nord',
    light: 'github-light',
    dark: 'nord',
    description: 'Cool dark Nord paired with a neutral light theme.',
  },
  'one-dark': {
    label: 'One Dark',
    light: 'one-light',
    dark: 'one-dark-pro',
    description: 'Atom-style light and dark syntax colors.',
  },
} satisfies Record<string, CodeThemePreset>

export type CodeThemePresetName = keyof typeof codeThemePresets

export const defaultCodeThemePresetName: CodeThemePresetName = 'catppuccin'

export function resolveCodeThemePreset(name?: string) {
  if (name && Object.hasOwn(codeThemePresets, name)) {
    return codeThemePresets[name as CodeThemePresetName]
  }

  return codeThemePresets[defaultCodeThemePresetName]
}

export function resolveCodeThemeName(name?: string): CodeThemePresetName {
  return name && Object.hasOwn(codeThemePresets, name)
    ? (name as CodeThemePresetName)
    : defaultCodeThemePresetName
}
