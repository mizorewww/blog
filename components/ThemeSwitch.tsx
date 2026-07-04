'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { getLocaleFromPathname, ui } from '@/lib/i18n'

const ThemeSwitch = () => {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const labels = ui[getLocaleFromPathname(usePathname())]

  useEffect(() => setMounted(true), [])

  return (
    <button
      type="button"
      aria-label={labels.toggleTheme}
      className="hover:text-sky-700 dark:hover:text-sky-300"
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
