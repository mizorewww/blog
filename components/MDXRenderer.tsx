'use client'

import React, { useMemo } from 'react'
import ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import type { MDXComponents } from 'mdx/types'

type MDXComponent = React.ComponentType<{ components?: MDXComponents }>

const mdxRuntimeScope = {
  React,
  ReactDOM,
  _jsx_runtime: jsxRuntime,
}

function getMDXComponent(code: string): MDXComponent {
  // Contentlayer emits runtime MDX as a function body. This keeps the pre-refactor
  // in-place expansion animation; replace it when the content pipeline supports
  // browser-loadable MDX modules without eval.
  const fn = new Function(...Object.keys(mdxRuntimeScope), code)

  return fn(...Object.values(mdxRuntimeScope)).default
}

export default function MDXRenderer({
  code,
  components,
}: {
  code: string
  components: MDXComponents
}) {
  const Component = useMemo(() => getMDXComponent(code), [code])

  return <Component components={components} />
}
