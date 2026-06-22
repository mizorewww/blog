import React from 'react'
import ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import type { MDXComponents } from 'mdx/types'
import { components as mdxComponents } from '@/components/MDXComponents'

type MDXComponent = React.ComponentType<{ components?: MDXComponents }>

const mdxRuntimeScope = {
  React,
  ReactDOM,
  _jsx_runtime: jsxRuntime,
}

function getMDXComponent(code: string): MDXComponent {
  const fn = new Function(...Object.keys(mdxRuntimeScope), code)

  return fn(...Object.values(mdxRuntimeScope)).default
}

export default function MDXServerRenderer({ code }: { code: string }) {
  const Component = getMDXComponent(code)

  return <Component components={mdxComponents} />
}
