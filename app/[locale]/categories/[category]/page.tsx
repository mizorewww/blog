import { generateTermPageMetadata, getTermStaticParams, renderTermPage } from '../../termRoutes'
import type { Metadata } from 'next'

export async function generateMetadata(props: {
  params: Promise<{ locale: string; category: string }>
}): Promise<Metadata> {
  return generateTermPageMetadata('categories', props)
}

export const generateStaticParams = async () => {
  return getTermStaticParams('categories')
}

export default async function CategoryPage(props: {
  params: Promise<{ locale: string; category: string }>
}) {
  return renderTermPage('categories', props)
}
