import type { MatchSummaryContract } from '@brawltome/contracts'
import { useRouter } from '@tanstack/react-router'
import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useState } from 'react'
import { ComingSoonPage } from '../coming-soon/ComingSoonPage'
import { MatchList } from './MatchList'
import { isUnfinished, type MatchesPage, uploadsInView } from './matches-model'
import { type ReplayUpload, useReplayUpload } from './use-replay-upload'
import { YourColumn } from './YourColumn'

const refreshEveryMs = 3000

// wider than the shared page column, as the profile page is, so a row has room for both sides and their names
const widePage =
  'xl:relative xl:left-1/2 xl:w-[min(calc(100vw-3.5625rem-8rem),102.5rem)] xl:-translate-x-1/2 ultrawide:w-[min(calc(100vw-3.5625rem-8rem),127.5rem)]'

const columns =
  'grid grid-cols-[minmax(0,1fr)] gap-x-14 gap-y-6 2xl:grid-cols-[25rem_minmax(0,1fr)] ultrawide:grid-cols-[28.75rem_minmax(0,1fr)]'

const listColumn =
  'min-w-0 divide-y divide-line/50 [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 2xl:border-l 2xl:border-line/50 2xl:pl-14'

export function MatchesView({ page }: { page: MatchesPage }) {
  if (page.kind === 'comingSoon') return <ComingSoonPage slug="matches" />

  const now = new Date(page.loadedAt)

  if (page.kind === 'signedOut') {
    const action = (
      <a href={page.signInUrl} className="text-sm font-semibold text-primary hover:underline">
        Sign in to upload
      </a>
    )

    return <EveryonesMatches recent={page.recent} now={now} action={action} />
  }

  if (!page.canUpload) {
    const action = (
      <a href="/account" className="text-sm font-semibold text-primary hover:underline">
        Link Steam to upload
      </a>
    )

    return <EveryonesMatches recent={page.recent} now={now} action={action} />
  }

  return <YourMatches page={page} now={now} />
}

type EveryonesMatchesProps = {
  recent: { matches: MatchSummaryContract[]; nextCursor: string | null }
  now: Date
  action: ReactNode
}

// a visitor who can't upload sees only the latest matches, with the one step that would let them
function EveryonesMatches({ recent, now, action }: EveryonesMatchesProps) {
  return (
    <div className="mx-auto max-w-5xl py-8">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-4xl leading-[1.15] font-black tracking-tight text-strong">Matches</h1>
        {action}
      </div>
      <MatchList
        title="Recently uploaded"
        list="recent"
        page={recent}
        yourId={null}
        now={now}
        empty={<NoMatchesYet />}
      />
    </div>
  )
}

function YourMatches({ page, now }: { page: Extract<MatchesPage, { kind: 'signedIn' }>; now: Date }) {
  const upload = useReplayUpload()
  const uploads = uploadsInView(page.replays, now)
  const yourId = page.mine.player?.brawlhallaId ?? null

  useRefreshWhileReading(page.replays.some(isUnfinished))

  return (
    <DropZone upload={upload}>
      <div className={`${columns} ${widePage} py-8`}>
        <YourColumn mine={page.mine} uploads={uploads} upload={upload} now={now} />
        <div className={listColumn}>
          <MatchList
            title="Your matches"
            list="mine"
            page={page.mine}
            yourId={yourId}
            now={now}
            empty={<DropHere upload={upload} />}
          />
          <MatchList
            title="Recently uploaded"
            list="recent"
            page={page.recent}
            yourId={yourId}
            now={now}
            empty={<NoMatchesYet />}
          />
        </div>
      </div>
    </DropZone>
  )
}

// while an upload is being read, the page checks on it again on its own
function useRefreshWhileReading(isReading: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!isReading) return

    const timer = setInterval(() => void router.invalidate(), refreshEveryMs)

    return () => clearInterval(timer)
  }, [isReading, router])
}

// replay files dropped anywhere on the page are uploaded
function DropZone({ upload, children }: { upload: ReplayUpload; children: ReactNode }) {
  const [isDragging, setIsDragging] = useState(false)

  // a dragged link or bit of text isn't an upload
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  function onDragOver(event: DragEvent) {
    if (!carriesFiles(event) || upload.isUploading) return

    event.preventDefault()
    setIsDragging(true)
  }

  // moving between the page's own elements fires a leave too; only leaving the page ends the drag
  function onDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setIsDragging(false)

    if (!upload.isUploading) void upload.upload([...event.dataTransfer.files])
  }

  return (
    <section
      aria-label="Your matches; drop replay files here to upload them"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative"
    >
      {children}
      {isDragging && (
        <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-ink/80">
          <span className="text-2xl font-black text-strong">Drop to upload</span>
        </div>
      )}
    </section>
  )
}

// the first thing a new uploader sees: where to drop, and where the game keeps the files
function DropHere({ upload }: { upload: ReplayUpload }) {
  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void upload.upload([...(event.target.files ?? [])])
    event.target.value = ''
  }

  return (
    <label className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line text-center transition-colors hover:bg-white/[0.04]">
      <span className="font-bold text-strong">{upload.isUploading ? 'Uploading…' : 'Drop .replay files'}</span>
      <span className="mt-1 text-sm text-soft">Documents/BrawlhallaReplays</span>
      <input
        type="file"
        accept=".replay"
        multiple
        className="sr-only"
        onChange={onPick}
        disabled={upload.isUploading}
      />
    </label>
  )
}

function NoMatchesYet() {
  return <p className="text-sm text-soft">No matches uploaded yet.</p>
}
