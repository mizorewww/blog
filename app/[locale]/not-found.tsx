import NotFoundPage from '@/components/NotFoundPage'
import siteMetadata from '@/data/siteMetadata'

export default function NotFound() {
  return (
    <>
      <title>{`404 | ${siteMetadata.title}`}</title>
      <NotFoundPage />
    </>
  )
}
