import {
  siApacheecharts,
  siCss,
  siGnubash,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siMarkdown,
  siMdx,
  siPython,
  siRust,
  siTypescript,
  siYaml,
} from 'simple-icons'

export type LanguageLogo = {
  hex: string
  path: string
  title: string
}

// Brand icons that are (near-)black and would disappear on dark surfaces.
// These are filled with currentColor instead of the brand hex.
const monochromeSlugs = new Set(['JSON', 'Markdown', 'MDX', 'Rust'])

function toLanguageLogo(icon: { hex: string; path: string; title: string }): LanguageLogo {
  return { hex: icon.hex, path: icon.path, title: icon.title }
}

const languageLogos: Record<string, LanguageLogo> = {
  bash: toLanguageLogo(siGnubash),
  css: toLanguageLogo(siCss),
  echarts: toLanguageLogo(siApacheecharts),
  go: toLanguageLogo(siGo),
  html: toLanguageLogo(siHtml5),
  js: toLanguageLogo(siJavascript),
  json: toLanguageLogo(siJson),
  jsx: toLanguageLogo(siJavascript),
  md: toLanguageLogo(siMarkdown),
  mdx: toLanguageLogo(siMdx),
  py: toLanguageLogo(siPython),
  python: toLanguageLogo(siPython),
  rs: toLanguageLogo(siRust),
  rust: toLanguageLogo(siRust),
  sh: toLanguageLogo(siGnubash),
  shell: toLanguageLogo(siGnubash),
  ts: toLanguageLogo(siTypescript),
  tsx: toLanguageLogo(siTypescript),
  yaml: toLanguageLogo(siYaml),
  yml: toLanguageLogo(siYaml),
  zsh: toLanguageLogo(siGnubash),
}

export function getLanguageLogo(language: string): LanguageLogo | null {
  return languageLogos[language.trim().toLowerCase()] ?? null
}

export function isMonochromeLogo(logo: LanguageLogo) {
  return monochromeSlugs.has(logo.title)
}
