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
      className="mr-3 text-sm font-medium text-sky-500 uppercase hover:text-sky-600 dark:hover:text-sky-400"
    >
      {text.split(' ').join('-')}
    </Link>
  )
}

export default Tag
