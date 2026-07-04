'use client'

import { usePathname } from 'next/navigation'
import siteMetadata from '@/data/siteMetadata'
import Icon from '@/components/Icon'
import SocialIcon from '@/components/social-icons'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

export default function Footer() {
  const commitHash = process.env.NEXT_PUBLIC_GIT_COMMIT_HASH
  const fullCommitHash = process.env.NEXT_PUBLIC_GIT_COMMIT_FULL_HASH || commitHash
  const commitUrl =
    commitHash && fullCommitHash ? `${siteMetadata.siteRepo}/commit/${fullCommitHash}` : ''
  const locale = getLocaleFromPathname(usePathname())
  const labels = ui[locale]

  return (
    <footer className="shrink-0 bg-transparent text-slate-500 dark:text-white/60">
      <div className="blog-shell dark:border-border-footer-dark mx-auto flex w-full flex-col items-center border-t border-slate-200 px-4 py-7 text-center">
        <div className="mb-3 flex space-x-4 text-slate-500 dark:text-white/60">
          <SocialIcon kind="mail" href={`mailto:${siteMetadata.email}`} size={6} locale={locale} />
          <SocialIcon kind="github" href={siteMetadata.github} size={6} locale={locale} />
          <SocialIcon kind="x" href={siteMetadata.x} size={6} locale={locale} />
          <SocialIcon kind="telegram" href={siteMetadata.telegram} size={6} locale={locale} />
        </div>
        <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-sm">
          <div>{siteMetadata.author}</div>
          <div>{` • `}</div>
          <div>{`© ${new Date().getFullYear()}`}</div>
          <div>{` • `}</div>
          <div>{siteMetadata.title}</div>
          {commitHash && (
            <>
              <div>{` • `}</div>
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={labels.latestCommit(commitHash)}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-slate-200/70 px-2 py-0.5 hover:text-sky-700 dark:bg-white/10 dark:hover:text-sky-300"
              >
                <Icon name="GitCommit" className="h-3.5 w-3.5" inlineSpacing={false} />
                <span className="text-xs tracking-[0.08em] uppercase">commit</span>
                <span className="font-mono">{commitHash}</span>
              </a>
            </>
          )}
        </div>
      </div>
    </footer>
  )
}
