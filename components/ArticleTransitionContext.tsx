'use client'

import { createContext, useContext, type ReactNode } from 'react'

type ArticleTransitionReturnRequest = () => boolean

const ArticleTransitionReturnContext = createContext<ArticleTransitionReturnRequest | null>(null)

export function ArticleTransitionProvider({
  children,
  requestReturn,
}: {
  children: ReactNode
  requestReturn: ArticleTransitionReturnRequest
}) {
  return (
    <ArticleTransitionReturnContext.Provider value={requestReturn}>
      {children}
    </ArticleTransitionReturnContext.Provider>
  )
}

export function useArticleTransitionReturn() {
  return useContext(ArticleTransitionReturnContext)
}
