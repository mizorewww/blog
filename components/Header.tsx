import HeaderLogo from './HeaderLogo'
import HeaderNavLinks from './HeaderNavLinks'
import ThemeSwitch from './ThemeSwitch'
import SearchButton from './SearchButton'
import LanguageSwitcher from './LanguageSwitcher'
import Link from './Link'

const RssIcon = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-6 w-6"
  >
    <path d="M4 11a9 9 0 0 1 9 9" />
    <path d="M4 4a16 16 0 0 1 16 16" />
    <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const Header = () => {
  return (
    <header className="fixed inset-x-0 top-0 z-50 w-full bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur dark:bg-[#252d38]/95 dark:shadow-none">
      <div className="header-shell mx-auto flex w-full flex-nowrap items-center justify-start gap-x-3 px-3 py-2.5 sm:justify-between sm:gap-x-7 sm:px-6 sm:py-4 lg:px-0">
        <HeaderLogo />
        <div className="flex min-w-0 items-center justify-start gap-x-3 text-sm leading-5 sm:justify-end sm:gap-x-6 sm:text-lg lg:text-xl">
          <HeaderNavLinks />
          <div className="flex shrink-0 items-center gap-x-3 text-slate-600 sm:gap-x-4 dark:text-white/90">
            <Link
              href="/feed.xml"
              aria-label="订阅 Atom RSS"
              className="hidden transition hover:text-sky-500 sm:inline-flex"
            >
              <RssIcon />
            </Link>
            <SearchButton />
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
