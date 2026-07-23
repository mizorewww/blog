'use client'

import { useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Check, Copy } from 'lucide-react'
import { siGithub } from 'simple-icons'
import { toast } from 'sonner'
import type { ComponentPropsWithoutRef } from 'react'
import { getLocaleFromPathname, ui } from '@/lib/i18n'
import { getLanguageLogo, isMonochromeLogo } from '@/lib/languageLogos'

type CodeBlockProps = ComponentPropsWithoutRef<'pre'> & {
  'data-code-language'?: string
  'data-code-title'?: string
  'data-language-label'?: string
  'data-source-url'?: string
}

function getCodeText(node: HTMLElement | null) {
  return node?.querySelector('code')?.textContent || node?.textContent || ''
}

export default function CodeBlock({
  children,
  className = '',
  'data-code-language': codeLanguage,
  'data-code-title': codeTitle,
  'data-language-label': languageLabel,
  'data-source-url': sourceUrl,
  ...props
}: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const [copied, setCopied] = useState(false)
  const labels = ui[getLocaleFromPathname(usePathname())]
  const logo = codeLanguage ? getLanguageLogo(codeLanguage) : null

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(getCodeText(preRef.current))
      setCopied(true)
      toast.success(labels.copiedCode)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  const languageMark = logo ? (
    <span
      aria-hidden="true"
      className="code-language-mark"
      style={isMonochromeLogo(logo) ? undefined : { color: `#${logo.hex}` }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d={logo.path} />
      </svg>
    </span>
  ) : languageLabel ? (
    <span aria-hidden="true" className="code-language-label">
      {languageLabel}
    </span>
  ) : null

  const copyButton = (
    <button
      type="button"
      aria-label={copied ? labels.copiedCode : labels.copyCode}
      aria-live="polite"
      onClick={onCopy}
      className={`dark:bg-surface-raised-dark/85 inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs shadow-sm backdrop-blur transition-colors duration-200 ${
        copied
          ? 'border-emerald-300/70 bg-emerald-50/90 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300'
          : 'border-slate-300/70 bg-white/85 text-slate-600 hover:border-sky-300 hover:text-sky-700 dark:border-white/15 dark:text-white/70 dark:hover:border-sky-400/40 dark:hover:text-sky-300'
      }`}
    >
      {copied ? (
        <Check aria-hidden="true" size={13} strokeWidth={2.5} />
      ) : (
        <Copy aria-hidden="true" size={13} />
      )}
      <span>{copied ? labels.copied : labels.copy}</span>
    </button>
  )

  const sourceLink = sourceUrl ? (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={codeLanguage === 'diff' ? labels.viewDiffOnGithub : labels.viewCodeOnGithub}
      className="inline-flex items-center gap-1 rounded-[6px] px-1 py-1 text-xs whitespace-nowrap text-slate-500 transition-colors hover:text-slate-800 dark:text-white/55 dark:hover:text-white/90"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
        <path d={siGithub.path} />
      </svg>
      <span className="hidden sm:inline">
        {codeLanguage === 'diff' ? labels.viewDiffOnGithub : labels.viewCodeOnGithub}
      </span>
    </a>
  ) : null

  // Titled or sourced blocks get one quiet text row above the code — no bar.
  if (codeTitle || sourceUrl) {
    return (
      <div>
        <div className="code-header flex items-center justify-between gap-3 px-4 pt-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {languageMark}
            {codeTitle ? (
              <span className="truncate font-mono text-xs text-slate-500 dark:text-white/50">
                {codeTitle}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {sourceLink}
            {copyButton}
          </span>
        </div>
        <pre ref={preRef} className={className} {...props}>
          {children}
        </pre>
      </div>
    )
  }

  return (
    <div className="code-block-floating relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        {languageMark}
        {copyButton}
      </div>
      <pre ref={preRef} className={className} {...props}>
        {children}
      </pre>
    </div>
  )
}
