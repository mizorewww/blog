import { resolveCodeThemePreset } from '../../../data/codeThemes'

const codeTheme = resolveCodeThemePreset(
  process.env.CODE_THEME || process.env.NEXT_PUBLIC_CODE_THEME
)

export const rehypePrettyCodeOptions = {
  theme: {
    light: codeTheme.light,
    dark: codeTheme.dark,
  },
  keepBackground: true,
  defaultLang: {
    block: 'plaintext',
    inline: '',
  },
  bypassInlineCode: true,
}
