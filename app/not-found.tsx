import NotFoundPage from '@/components/NotFoundPage'
import siteMetadata from '@/data/siteMetadata'

export default function NotFound() {
  return (
    <>
      <title>{`404 | ${siteMetadata.title}`}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" type="image/svg+xml" href="/static/favicons/favicon.svg" />
      <NotFoundPage />
    </>
  )
}
