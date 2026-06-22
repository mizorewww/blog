import Link from '@/components/Link'
import { defaultLocale, ui } from '@/lib/i18n'

export default function NotFound() {
  const labels = ui[defaultLocale]

  return (
    <div className="flex flex-col items-start justify-start md:mt-24 md:flex-row md:items-center md:justify-center md:space-x-6">
      <div className="space-x-2 pt-6 pb-8 md:space-y-5">
        <h1 className="text-6xl leading-9 font-extrabold tracking-tight text-gray-900 md:border-r-2 md:px-6 md:text-8xl md:leading-14 dark:text-gray-100">
          404
        </h1>
      </div>
      <div className="max-w-md">
        <p className="mb-4 text-xl leading-normal font-bold md:text-2xl">{labels.notFoundTitle}</p>
        <p className="mb-8">{labels.notFoundDescription}</p>
        <Link
          href="/"
          className="inline rounded-[8px] border border-transparent bg-sky-500 px-4 py-2 text-sm leading-5 font-medium text-white shadow-xs transition-colors duration-150 hover:bg-sky-400 focus:outline-hidden"
        >
          {labels.backToHome}
        </Link>
      </div>
    </div>
  )
}
