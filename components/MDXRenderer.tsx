'use client'

import React, { useMemo } from 'react'
import ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'
import type { MDXComponents } from 'mdx/types'

type MDXComponent = React.ComponentType<{ components?: MDXComponents }>

function getMDXComponent(code: string): MDXComponent {
  const scope = {
    React,
    ReactDOM,
    _jsx_runtime: jsxRuntime,
  }
  const fn = new Function(...Object.keys(scope), code)

  return fn(...Object.values(scope)).default
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
