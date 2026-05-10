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
      <div className="blog-shell mx-auto flex w-full flex-wrap items-center justify-center gap-x-7 gap-y-3 px-4 py-3 sm:justify-between sm:px-6 sm:py-4 lg:px-0">
        <HeaderLogo />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-base leading-5 sm:text-lg lg:text-xl">
          <HeaderNavLinks />
          <div className="flex items-center gap-x-4 text-slate-600 dark:text-white/90">
            <Link
              href="/feed.xml"
              aria-label="订阅 Atom RSS"
              className="transition hover:text-sky-500"
            >
              <RssIcon />
            </Link>
            <SearchButton />
            <LanguageSwitcher />
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
