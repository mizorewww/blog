import type { ReactNode } from 'react'

const TableWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <div className="w-full overflow-x-auto">
      <table>{children}</table>
    </div>
  )
}

export default TableWrapper
