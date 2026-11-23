import { PageControls, Pager } from './Pager'
import { pageCount } from './page-number'

type RankingPagerProps = {
  label: string
  page: number
  totalRows: number
  pageSize: number
  lastPage: number
  onPage: (page: number) => void
}

// one page of rows needs no pager, a page past the end keeps it to get back
function needsPager(pages: number, page: number): boolean {
  return pages > 1 || page > 1
}

export function RankingPager({ label, page, totalRows, pageSize, lastPage, onPage }: RankingPagerProps) {
  const pages = pageCount(totalRows, pageSize, lastPage)

  if (!needsPager(pages, page)) return null

  return (
    <div className="mt-2">
      <Pager label={label} page={page} pages={pages} pageSize={pageSize} total={totalRows} onPage={onPage} />
    </div>
  )
}

/** The same paging at the top of a board, so a reader doesn't have to scroll to the end to turn the page. */
export function RankingTopPager({ label, page, totalRows, pageSize, lastPage, onPage }: RankingPagerProps) {
  const pages = pageCount(totalRows, pageSize, lastPage)

  if (!needsPager(pages, page)) return null

  return <PageControls label={label} navLabel={`${label} pages, top`} page={page} pages={pages} onPage={onPage} />
}
