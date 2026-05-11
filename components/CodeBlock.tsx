'use client'

import { useRef, useState } from 'react'
import type { ComponentPropsWithoutRef } from 'react'

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
        aria-label={copied ? '已复制代码' : '复制代码'}
        onClick={onCopy}
        className="absolute top-2 right-2 z-10 rounded-[6px] border border-slate-300/70 bg-white/85 px-2 py-1 text-xs text-slate-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 hover:text-sky-500 focus:opacity-100 dark:border-white/15 dark:bg-[#1f2937]/85 dark:text-white/70 dark:hover:text-sky-400"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={preRef} className={className} {...props}>
        {children}
      </pre>
    </div>
  )
}
