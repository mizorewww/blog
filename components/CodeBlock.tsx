'use client'

import { useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ComponentPropsWithoutRef } from 'react'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

function getCodeText(node: HTMLElement | null) {
  return node?.querySelector('code')?.textContent || node?.textContent || ''
}

export default function CodeBlock({
  children,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement | null>(null)
  const [copied, setCopied] = useState(false)
  const labels = ui[getLocaleFromPathname(usePathname())]

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(getCodeText(preRef.current))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={copied ? labels.copiedCode : labels.copyCode}
        aria-live="polite"
        onClick={onCopy}
        className="dark:bg-surface-raised-dark/85 absolute top-2 right-2 z-10 rounded-[6px] border border-slate-300/70 bg-white/85 px-2 py-1 text-xs text-slate-600 opacity-100 shadow-sm backdrop-blur hover:text-sky-700 focus:opacity-100 dark:border-white/15 dark:text-white/70 dark:hover:text-sky-300 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
      >
        {copied ? labels.copied : labels.copy}
      </button>
      <pre ref={preRef} className={className} {...props}>
        {children}
      </pre>
    </div>
  )
}
