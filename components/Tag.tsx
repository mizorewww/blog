import Link from 'next/link'
import { slug } from 'github-slugger'
import { localizePath, type Locale } from '@/lib/i18n'
interface Props {
  text: string
  locale?: Locale
}

const Tag = ({ text, locale }: Props) => {
  const href = locale ? localizePath(`/tags/${slug(text)}`, locale) : `/tags/${slug(text)}`

  return (
    <Link
      href={href}
      className="text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 mr-3 text-sm font-medium uppercase"
    >
      {text.split(' ').join('-')}
    </Link>
  )
}

export default Tag
