import JsonLd from '@/components/JsonLd'
import TermIndexView from '@/components/TermIndexView'
import siteMetadata from '@/data/siteMetadata'
import ListLayout from '@/layouts/ListLayoutWithTags'
import {
  getCategoryListData,
  getLocaleParams,
  getLocalizedCategoryParams,
  getLocalizedTagParams,
  getTagListData,
} from '@/lib/content/posts'
import { buildTermIndexPageData, buildTermPageMeta } from '@/lib/content/termPages'
import { getTermRouteField, type TermField } from '@/lib/content/terms'
import { isLocale, type Locale } from '@/lib/i18n'
import { createPostCollectionJsonLd } from '@/lib/structuredData'
import { genPageMetadata } from 'app/seo'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type LocaleParams = {
  params: Promise<{ locale: string }>
}

type TermParams = {
  params: Promise<{ locale: string; term: string }>
}

type RawTermParams = {
  params: Promise<{ locale: string; category?: string; tag?: string }>
}

function normalizeTermParams(field: TermField, props: RawTermParams): TermParams {
  return {
    params: props.params.then((params) => ({
      locale: params.locale,
      term: params[getTermRouteField(field)] || '',
    })),
  }
}

function getListData(locale: Locale, field: TermField, slug: string) {
  return field === 'categories' ? getCategoryListData(locale, slug) : getTagListData(locale, slug)
}

export function getTermStaticParams(field: TermField) {
  return field === 'categories' ? getLocalizedCategoryParams() : getLocalizedTagParams()
}

export function getTermIndexStaticParams() {
  return getLocaleParams()
}

export async function generateTermIndexMetadata(
  field: TermField,
  props: LocaleParams
): Promise<Metadata> {
  const params = await props.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const data = buildTermIndexPageData(params.locale, field)

  return genPageMetadata({
    title: data.title,
    description: data.description,
  })
}

export async function renderTermIndexPage(field: TermField, props: LocaleParams) {
  const params = await props.params
  const locale = params.locale

  if (!isLocale(locale)) {
    return notFound()
  }

  const data = buildTermIndexPageData(locale, field)

  return (
    <>
      <JsonLd data={data.jsonLd} />
      <TermIndexView field={field} locale={locale} terms={data.terms} title={data.title} />
    </>
  )
}

export async function generateTermPageMetadata(
  field: TermField,
  props: RawTermParams
): Promise<Metadata> {
  const normalizedProps = normalizeTermParams(field, props)
  const params = await normalizedProps.params

  if (!isLocale(params.locale)) {
    return {}
  }

  const termMeta = buildTermPageMeta(params.locale, field, params.term)
  const rssAlternate =
    field === 'tags'
      ? {
          types: {
            'application/rss+xml': `${siteMetadata.siteUrl}/${params.locale}/tags/${termMeta.slug}/feed.xml`,
          },
        }
      : {}

  return genPageMetadata({
    title: termMeta.term,
    description: termMeta.description,
    alternates: {
      canonical: termMeta.url,
      ...rssAlternate,
    },
  })
}

export async function renderTermPage(field: TermField, props: RawTermParams) {
  const normalizedProps = normalizeTermParams(field, props)
  const params = await normalizedProps.params

  if (!isLocale(params.locale)) {
    return notFound()
  }

  const termMeta = buildTermPageMeta(params.locale, field, params.term)
  const { posts, categoryCounts, tagCounts } = getListData(params.locale, field, termMeta.slug)
  const jsonLd = createPostCollectionJsonLd({
    title: termMeta.title,
    description: termMeta.description,
    url: termMeta.url,
    locale: params.locale,
    posts,
  })

  return (
    <>
      <JsonLd data={jsonLd} />
      <ListLayout
        posts={posts}
        title={termMeta.title}
        locale={params.locale}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />
    </>
  )
}
