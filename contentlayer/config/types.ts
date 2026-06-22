export type MdastNode = {
  type?: string
  value?: string
  lang?: string
  meta?: string
  children?: MdastNode[]
  [key: string]: unknown
}

export type HastNode = {
  data?: Record<string, unknown>
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}
