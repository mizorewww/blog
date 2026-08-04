import Link from '@/components/Link'
import { divider, mutedText, skyLink } from '@/components/ui/styles'
import type { Locale } from '@/lib/i18n'

export default function ArticleLicenseNotice({ locale }: { locale: Locale }) {
  const isZh = locale === 'zh'
  const licenseHref = isZh
    ? 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans'
    : 'https://creativecommons.org/licenses/by-nc-sa/4.0/'

  return (
    <div
      className={`article-content-rail article-data-block not-prose mt-10 border-t ${divider} pt-4 text-sm leading-7 ${mutedText}`}
    >
      {isZh ? (
        <p>
          除另有说明，本文内容采用{' '}
          <Link href={licenseHref} className={skyLink}>
            CC BY-NC-SA 4.0
          </Link>{' '}
          协议许可。转载或改编请署名、非商业使用，并以相同方式共享。
        </p>
      ) : (
        <p>
          Unless noted otherwise, this post is licensed under{' '}
          <Link href={licenseHref} className={skyLink}>
            CC BY-NC-SA 4.0
          </Link>
          . Please attribute, use non-commercially, and share adaptations under the same terms.
        </p>
      )}
    </div>
  )
}
