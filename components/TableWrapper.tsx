import type { ReactNode } from 'react'

const TableWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <div className="article-table-scroll">
      <table>{children}</table>
    </div>
  )
}

export default TableWrapper
