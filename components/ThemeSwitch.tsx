'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import { getLocaleFromPathname, ui } from '@/lib/i18n'
import { animataEase } from '@/components/animata/motion'

const ThemeSwitch = () => {
  const [mounted, setMounted] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const labels = ui[getLocaleFromPathname(usePathname())]
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => setMounted(true), [])

  const transition = shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: animataEase }

  return (
    <motion.button
      type="button"
      aria-label={labels.toggleTheme}
      className="hover:text-sky-700 dark:hover:text-sky-300"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      whileHover={shouldReduceMotion ? undefined : { scale: 1.1 }}
      whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mounted && resolvedTheme === 'light' ? (
          <motion.div
            key="sun"
            initial={shouldReduceMotion ? false : { opacity: 0, rotate: -90 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 90 }}
            transition={transition}
            className="inline-flex"
          >
            <Sun aria-hidden="true" className="h-6 w-6" />
          </motion.div>
        ) : (
          <motion.div
            key="moon"
            initial={shouldReduceMotion ? false : { opacity: 0, rotate: 90 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: -90 }}
            transition={transition}
            className="inline-flex"
          >
            <Moon aria-hidden="true" className="h-6 w-6" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

export default ThemeSwitch
