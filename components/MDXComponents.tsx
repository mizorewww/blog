import type { MDXComponents } from 'mdx/types'
import CodeBlock from './CodeBlock'
import Image from './Image'
import CustomLink from './Link'
import TableWrapper from './TableWrapper'

export const components: MDXComponents = {
  Image,
  a: CustomLink,
  pre: CodeBlock,
  table: TableWrapper,
}
