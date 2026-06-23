import {
  generateTermIndexMetadata,
  getTermIndexStaticParams,
  renderTermIndexPage,
} from '../termRoutes'
import type { Metadata } from 'next'

export const generateStaticParams = async () => {
  return getTermIndexStaticParams()
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  return generateTermIndexMetadata('categories', props)
}

export default async function Page(props: { params: Promise<{ locale: string }> }) {
  return renderTermIndexPage('categories', props)
}
