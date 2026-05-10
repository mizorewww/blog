import siteMetadata from '@/data/siteMetadata'
import HeaderLogo from './HeaderLogo'
import HeaderNavLinks from './HeaderNavLinks'
import LanguageSwitcher from './LanguageSwitcher'
import MobileNav from './MobileNav'
import ThemeSwitch from './ThemeSwitch'
import SearchButton from './SearchButton'

const Header = () => {
  let headerClass = 'flex items-center w-full bg-white dark:bg-gray-950 justify-between py-10'
  if (siteMetadata.stickyNav) {
    headerClass += ' sticky top-0 z-50'
  }

  return (
    <header className={headerClass}>
      <HeaderLogo />
      <div className="flex items-center space-x-4 leading-5 sm:-mr-6 sm:space-x-6">
        <HeaderNavLinks />
        <LanguageSwitcher />
        <SearchButton />
        <ThemeSwitch />
        <MobileNav />
      </div>
    </header>
  )
}

export default Header
