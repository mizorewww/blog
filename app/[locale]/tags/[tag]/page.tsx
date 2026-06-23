import { generateTermPageMetadata, getTermStaticParams, renderTermPage } from '../../termRoutes'
import type { Metadata } from 'next'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; tag: string }>
}): Promise<Metadata> {
  return generateTermPageMetadata('tags', props)
}

export const generateStaticParams = async () => {
  return getTermStaticParams('tags')
}

export default async function TagPage(props: { params: Promise<{ locale: string; tag: string }> }) {
  return renderTermPage('tags', props)
}
