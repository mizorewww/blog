import HeaderLogo from './HeaderLogo'
import HeaderNavLinks from './HeaderNavLinks'
import ThemeSwitch from './ThemeSwitch'
import LanguageSwitcher from './LanguageSwitcher'
import Link from './Link'
import Icon from './Icon'
import { defaultLocale, ui } from '@/lib/i18n'

const Header = ({ hideOnMobile = false }: { hideOnMobile?: boolean }) => {
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 w-full bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:translate-y-0 sm:opacity-100 dark:bg-[#252d38]/95 dark:shadow-none ${
        hideOnMobile
          ? 'pointer-events-none -translate-y-full opacity-0 sm:pointer-events-auto'
          : 'translate-y-0 opacity-100'
      }`}
    >
      <div className="header-shell relative mx-auto flex w-full items-center justify-between gap-x-3 px-3 py-2.5 sm:flex-nowrap sm:gap-x-7 sm:px-6 sm:py-4 lg:px-0">
        <div className="z-10 shrink-0">
          <HeaderLogo />
        </div>
        <div className="absolute top-1/2 left-1/2 max-w-[calc(100vw-132px)] min-w-0 -translate-x-1/2 -translate-y-1/2 text-sm leading-5 sm:static sm:ml-auto sm:max-w-none sm:translate-x-0 sm:translate-y-0 sm:text-lg lg:text-xl">
          <HeaderNavLinks />
        </div>
        <div className="z-10 flex shrink-0 items-center gap-x-3 text-slate-600 sm:gap-x-4 dark:text-white/90">
          <Link
            href="/feed.xml"
            aria-label={ui[defaultLocale].subscribeRss}
            className="hidden transition hover:text-sky-500 sm:inline-flex"
          >
            <Icon name="Rss" className="h-6 w-6" inlineSpacing={false} />
          </Link>
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <ThemeSwitch />
        </div>
      </div>
    </header>
  )
}

export default Header
