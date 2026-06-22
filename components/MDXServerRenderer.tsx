import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type React from 'react'
import type { MDXComponents } from 'mdx/types'
import { components as mdxComponents } from '@/components/MDXComponents'

type MDXComponent = React.ComponentType<{ components?: MDXComponents }>
type MDXModule = { default: MDXComponent }

async function loadMdxComponent(modulePath: string): Promise<MDXComponent> {
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), modulePath)).href
  const mdxModule = (await import(/* webpackIgnore: true */ moduleUrl)) as MDXModule

  return mdxModule.default
}

export default async function MDXServerRenderer({ modulePath }: { modulePath: string }) {
  const Component = await loadMdxComponent(modulePath)

  return <Component components={mdxComponents} />
}
