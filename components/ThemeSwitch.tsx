'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

const ThemeSwitch = () => {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => setMounted(true), [])

  return (
    <button
      type="button"
      aria-label="切换暗色模式"
      className="transition hover:text-sky-500"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
        {mounted && resolvedTheme === 'light' ? (
          <path d="M12 18.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm0 3.5a1 1 0 0 1-1-1v-1.2a1 1 0 1 1 2 0V21a1 1 0 0 1-1 1Zm0-17.8a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1.2a1 1 0 0 1-1 1ZM3 13H1.8a1 1 0 1 1 0-2H3a1 1 0 1 1 0 2Zm19.2 0H21a1 1 0 1 1 0-2h1.2a1 1 0 1 1 0 2ZM5.64 7.05l-.85-.84a1 1 0 0 1 1.42-1.42l.84.85a1 1 0 0 1-1.41 1.41Zm13.57 12.16-.84-.85a1 1 0 1 1 1.41-1.41l.85.84a1 1 0 0 1-1.42 1.42Zm-.84-12.16a1 1 0 0 1 0-1.41l.84-.85a1 1 0 0 1 1.42 1.42l-.85.84a1 1 0 0 1-1.41 0ZM4.79 19.21a1 1 0 0 1 0-1.42l.85-.84a1 1 0 0 1 1.41 1.41l-.84.85a1 1 0 0 1-1.42 0Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path fill="#252d38" d="M12 3a9 9 0 0 1 0 18Z" />
          </>
        )}
      </svg>
    </button>
  )
}

export default ThemeSwitch
