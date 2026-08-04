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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const labels = ui[getLocaleFromPathname(usePathname())]
  const logo = codeLanguage ? getLanguageLogo(codeLanguage) : null
  const copyStatusMessage =
    copyState === 'copied' ? labels.copiedCode : copyState === 'error' ? labels.copyCodeFailed : ''

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(getCodeText(preRef.current))
      setCopyState('copied')
      toast.success(labels.copiedCode)
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('error')
      toast.error(labels.copyCodeFailed)
      window.setTimeout(() => setCopyState('idle'), 2400)
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
      aria-label={
        copyState === 'copied'
          ? labels.copiedCode
          : copyState === 'error'
            ? labels.copyCodeFailed
            : labels.copyCode
      }
      onClick={onCopy}
      data-code-copy
      className={`dark:bg-surface-raised-dark/85 inline-flex min-h-11 items-center gap-1.5 rounded-[6px] border px-2.5 text-xs shadow-sm backdrop-blur transition-colors duration-200 ${
        copyState === 'copied'
          ? 'border-emerald-300/70 bg-emerald-50/90 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300'
          : copyState === 'error'
            ? 'border-amber-300/80 bg-amber-50/90 text-amber-800 dark:border-amber-300/30 dark:text-amber-200'
            : 'border-slate-300/70 bg-white/85 text-slate-600 hover:border-sky-300 hover:text-sky-700 dark:border-white/15 dark:text-white/70 dark:hover:border-sky-400/40 dark:hover:text-sky-300'
      }`}
    >
      {copyState === 'copied' ? (
        <Check aria-hidden="true" size={13} strokeWidth={2.5} />
      ) : (
        <Copy aria-hidden="true" size={13} />
      )}
      <span>
        {copyState === 'copied'
          ? labels.copied
          : copyState === 'error'
            ? labels.copyFailed
            : labels.copy}
      </span>
    </button>
  )

  const sourceLink = sourceUrl ? (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={codeLanguage === 'diff' ? labels.viewDiffOnGithub : labels.viewCodeOnGithub}
      className="inline-flex min-h-11 items-center gap-1 rounded-[6px] px-2 text-xs whitespace-nowrap text-slate-500 transition-colors duration-150 hover:text-slate-800 dark:text-white/55 dark:hover:text-white/90"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
        <path d={siGithub.path} />
      </svg>
      <span className="hidden sm:inline">
        {codeLanguage === 'diff' ? labels.viewDiffOnGithub : labels.viewCodeOnGithub}
      </span>
    </a>
  ) : null

  return (
    <div className="code-block-shell">
      <div
        className="code-header flex min-h-12 items-center justify-between gap-3 px-3 py-2 sm:px-4"
        data-code-header
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {languageMark}
          {codeTitle ? (
            <span className="truncate font-mono text-xs text-slate-500 dark:text-white/50">
              {codeTitle}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {sourceLink}
          {copyButton}
        </span>
      </div>
      <div role="status" className="sr-only">
        {copyStatusMessage}
      </div>
      <pre ref={preRef} className={className} data-code-pre {...props}>
        {children}
      </pre>
    </div>
  )
}
