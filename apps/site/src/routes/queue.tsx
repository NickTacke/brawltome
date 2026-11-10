import type { LeaderboardRecentActivityOutput } from '@brawltome/contracts'
import { createFileRoute } from '@tanstack/react-router'
import { FilterSelect } from '../components/FilterSelect'
import { bracketOptions } from '../components/home/home-filters'
import { Pager } from '../components/Pager'
import { QueueBody } from '../components/queue/QueueBody'
import { QueueMovers, QueueMoversSkeleton } from '../components/queue/QueueMovers'
import { hasPager, rowNoun, spanLabel } from '../components/queue/queue-format'
import { queueQuery, validateQueueSearch } from '../components/queue/queue-search'
import { regionOptions } from '../components/regions'
import { useSlowNavigation } from '../components/use-slow-navigation'
import { formatWhole, timeAgo } from '../lib'
import type { QueueMovers as QueueMoversData } from '../server/load-queue'
import { getQueue } from '../server/queue'

export const Route = createFileRoute('/queue')({
  validateSearch: validateQueueSearch,
  loaderDeps: ({ search }) => queueQuery(search),
  loader: ({ deps }) => getQueue({ data: deps }),
  head: () => ({ meta: [{ title: 'Queue | BrawlTome' }] }),
  errorComponent: QueueLoadError,
  component: QueuePage,
})

type AvailableView = Extract<LeaderboardRecentActivityOutput, { status: 'fresh' | 'stale' }>

// the queue's table on the left and a sticky column on the right from 1280 wide, the same frame as the guild page
const pageStyle =
  '[--gutter:max(4rem,calc((100vw-57px-1080px-380px)/3))] md:px-[max(0px,calc(40px-max(0px,(100vw-1209px)/2)))] xl:relative xl:left-1/2 xl:grid xl:w-[calc(100vw-57px)] xl:-translate-x-1/2 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr] xl:px-(--gutter)'

function Updated({ view, className }: { view: AvailableView; className: string }) {
  return (
    <div suppressHydrationWarning className={className}>
      Updated {timeAgo(view.publishedAt)}
    </div>
  )
}

function QueueSummary({ view }: { view: AvailableView }) {
  return (
    <div className="flex items-center justify-between gap-6 text-soft">
      <div>
        {formatWhole(view.totalRows)} {rowNoun(view.mode)} · {spanLabel(view)}
      </div>
      <Updated view={view} className="sm:hidden" />
    </div>
  )
}

function SideColumn({ movers, isLoading }: { movers: QueueMoversData; isLoading: boolean }) {
  return (
    <aside className="mt-9 hidden min-w-0 border-l border-line/50 pl-12 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:block">
      <div className="sticky top-10">{isLoading ? <QueueMoversSkeleton /> : <QueueMovers {...movers} />}</div>
    </aside>
  )
}

function QueuePage() {
  const { view, movers } = Route.useLoaderData()
  const search = Route.useSearch()
  const { mode, region } = queueQuery(search)
  const isLoading = useSlowNavigation()
  const navigate = Route.useNavigate()

  function changePage(page: number) {
    void navigate({ search: (previous) => validateQueueSearch({ ...previous, page }), resetScroll: false })
  }

  function changeFilter(next: { mode?: string; region?: string }) {
    void navigate({ search: (previous) => validateQueueSearch({ ...previous, ...next, page: 1 }), resetScroll: false })
  }

  const available = view.status === 'unavailable' ? null : view
  const sideMovers = available && available.entries.length > 0 ? movers : null
  const columnStyle = sideMovers ? 'xl:col-start-1 xl:pr-(--gutter)' : 'xl:col-span-2'

  return (
    <div className={pageStyle}>
      <div className={`flex items-end justify-between gap-6 ${columnStyle}`}>
        <h1 className="text-3xl font-black tracking-tight text-strong sm:text-5xl">Queue</h1>
        {available && <Updated view={available} className="hidden pb-1 text-soft sm:block" />}
      </div>

      <section aria-label="Recent activity" className={`mt-3 min-w-0 xl:row-start-2 ${columnStyle}`}>
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          {available && <QueueSummary view={available} />}
          <div className="flex items-center gap-4 sm:ml-auto">
            <FilterSelect
              label="Region"
              isIconOnly
              value={region}
              options={regionOptions}
              onChange={(value) => changeFilter({ region: value })}
            />
            <FilterSelect
              label="Bracket"
              value={mode}
              options={bracketOptions}
              onChange={(value) => changeFilter({ mode: value })}
            />
          </div>
        </div>

        <QueueBody view={view} isLoading={isLoading} />

        {available && hasPager(available) && <QueuePager view={available} onPage={changePage} />}
      </section>

      {sideMovers && <SideColumn movers={sideMovers} isLoading={isLoading} />}
    </div>
  )
}

function QueuePager({ view, onPage }: { view: AvailableView; onPage: (page: number) => void }) {
  const pages = Math.ceil(view.totalRows / view.pageSize)

  return (
    <Pager
      label="Queue"
      page={view.page}
      pages={pages}
      pageSize={view.pageSize}
      total={view.totalRows}
      onPage={onPage}
    />
  )
}

// a fixed message, the error itself is for the server log
function QueueLoadError() {
  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">The queue couldn't be loaded</h1>
      <p className="mt-2 text-soft">Something went wrong on our side. It's usually back in a moment.</p>
      <a href="/queue" className="mt-4 inline-block text-primary underline underline-offset-4">
        Try again
      </a>
    </div>
  )
}
