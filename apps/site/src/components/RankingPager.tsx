import { Pager } from './Pager'
import { pageCount } from './page-number'

type RankingPagerProps = {
  label: string
  page: number
  totalRows: number
  pageSize: number
  lastPage: number
  onPage: (page: number) => void
}

export function RankingPager({ label, page, totalRows, pageSize, lastPage, onPage }: RankingPagerProps) {
  const pages = pageCount(totalRows, pageSize, lastPage)

  // one page of rows needs no pager, a page past the end keeps it to get back
  if (pages <= 1 && page <= 1) return null

  return (
    <div className="mt-2">
      <Pager label={label} page={page} pages={pages} pageSize={pageSize} total={totalRows} onPage={onPage} />
    </div>
  )
}
