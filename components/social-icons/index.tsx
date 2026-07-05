import { Mail, Github, X, Telegram } from './icons'
import { ui, type Locale } from '@/lib/i18n'

const components = {
  mail: Mail,
  github: Github,
  x: X,
  telegram: Telegram,
}

const sizeClasses: Record<number, string> = {
  4: 'h-4 w-4',
  5: 'h-5 w-5',
  6: 'h-6 w-6',
  8: 'h-8 w-8',
  10: 'h-10 w-10',
  12: 'h-12 w-12',
}

type SocialIconProps = {
  kind: keyof typeof components
  href: string | undefined
  size?: number
  locale: Locale
}

const SocialIcon = ({ kind, href, size = 8, locale }: SocialIconProps) => {
  if (
    !href ||
    (kind === 'mail' && !/^mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(href))
  )
    return null

  const SocialSvg = components[kind]

  return (
    <a
      className="rounded-full p-2 transition-colors duration-200 hover:bg-slate-100 dark:hover:bg-white/10"
      target="_blank"
      rel="noopener noreferrer"
      href={href}
      aria-label={ui[locale].socialLabels[kind]}
    >
      <span className="sr-only">{ui[locale].socialLabels[kind]}</span>
      <SocialSvg
        className={`fill-current text-slate-700 hover:text-sky-700 dark:text-white/80 dark:hover:text-sky-400 ${sizeClasses[size] ?? 'h-8 w-8'}`}
      />
    </a>
  )
}

export default SocialIcon
