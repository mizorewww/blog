import TOCInline from 'pliny/ui/TOCInline'
import type { MDXComponents } from 'mdx/types'
import CodeBlock from './CodeBlock'
import Image from './Image'
import CustomLink from './Link'
import TableWrapper from './TableWrapper'

export const components: MDXComponents = {
  Image,
  TOCInline,
  a: CustomLink,
  pre: CodeBlock,
  table: TableWrapper,
}
