import type { MDXComponents } from 'mdx/types'
import CodeBlock from './CodeBlock'
import Icon from './Icon'
import Image from './Image'
import MDXImage from './MDXImage'
import CustomLink from './Link'
import TableWrapper from './TableWrapper'
import { TradingViewAdvancedChart, TradingViewMiniChart } from './TradingViewWidgets'

export const components: MDXComponents = {
  Icon,
  Image,
  TradingViewAdvancedChart,
  TradingViewMiniChart,
  a: CustomLink,
  img: MDXImage,
  pre: CodeBlock,
  table: TableWrapper,
}
