'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { defaultLocale, ui } from '@/lib/i18n'

const ThemeSwitch = () => {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => setMounted(true), [])

  return (
    <button
      type="button"
      aria-label={ui[defaultLocale].toggleTheme}
      className="hover:text-sky-500"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolvedTheme === 'light' ? (
        <Sun aria-hidden="true" className="h-6 w-6" />
      ) : (
        <Moon aria-hidden="true" className="h-6 w-6" />
      )}
    </button>
  )
}

export default ThemeSwitch
