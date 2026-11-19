import type { MyMatchesContract, MyReplayContract } from '@brawltome/contracts'
import { Link } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { sectionBody, sectionTitle } from '../player/player-styles'
import { SplitRecord } from '../player/SplitRecord'
import { shortAgo } from './match-row-model'
import { replayStatusText } from './matches-model'
import type { ReplayUpload } from './use-replay-upload'

// the visitor's side of the page, laid out like a profile's: who they are, what they're uploading, how they've done
// and what they've played. stacked above the lists as a band below 2xl, a column beside them from there

const column =
  'min-w-0 self-start border-b border-line/50 pb-5 md:max-2xl:grid md:max-2xl:grid-cols-2 md:max-2xl:gap-x-12 2xl:sticky 2xl:top-10 2xl:flex 2xl:flex-col 2xl:divide-y 2xl:divide-line/50 2xl:border-b-0 2xl:pb-0 2xl:[&>*]:py-3.5 2xl:[&>*:first-child]:pt-0'

type YourColumnProps = { mine: MyMatchesContract; uploads: MyReplayContract[]; upload: ReplayUpload; now: Date }

export function YourColumn({ mine, uploads, upload, now }: YourColumnProps) {
  return (
    <aside className={column}>
      <Identity mine={mine} upload={upload} now={now} />
      <Record record={mine.record} />
      <Uploads uploads={uploads} message={upload.message} />
      <Legends legends={mine.record.legends} />
    </aside>
  )
}

function Identity({ mine, upload, now }: { mine: MyMatchesContract; upload: ReplayUpload; now: Date }) {
  const { player, record } = mine
  const mainLegend = record.legends[0]?.legendKey ?? null

  return (
    <div className="flex items-center gap-4 max-md:pb-4">
      <img
        src={legendAvatarUrl(mainLegend)}
        alt=""
        className="size-24 shrink-0 rounded-xl bg-raised object-cover object-top 2xl:size-28"
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-4xl leading-[1.15] font-black tracking-tight text-strong">
          {player?.name ? (
            <Link to="/player/$id" params={{ id: String(player.brawlhallaId) }} className="hover:text-primary">
              {player.name}
            </Link>
          ) : (
            'Matches'
          )}
        </h1>
        <div className="mt-0.5 text-sm text-soft">
          <span className="font-semibold text-text">{record.games} matches</span>
          {record.lastParsedAt && <> · last {shortAgo(record.lastParsedAt, now)}</>}
        </div>
        <UploadButton upload={upload} />
      </div>
    </div>
  )
}

function UploadButton({ upload }: { upload: ReplayUpload }) {
  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void upload.upload([...(event.target.files ?? [])])
    event.target.value = ''
  }

  return (
    <label className="mt-2.5 inline-flex cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-ink transition-[filter] hover:brightness-110 has-[:disabled]:cursor-default has-[:disabled]:opacity-70">
      {upload.isUploading ? 'Uploading…' : 'Upload replays'}
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

function Record({ record }: { record: MyMatchesContract['record'] }) {
  return (
    <section className="max-md:border-t max-md:border-line/50 max-md:pt-3">
      <h2 className={sectionTitle}>Record</h2>
      <div className={sectionBody}>
        <SplitRecord standing={record} emptyText="No matches yet" />
      </div>
    </section>
  )
}

// only while something is being read, or failed lately
function Uploads({ uploads, message }: { uploads: MyReplayContract[]; message: string | null }) {
  if (uploads.length === 0 && !message) return null

  return (
    <section className="max-2xl:mt-3">
      <h2 className={sectionTitle}>Uploads</h2>
      <ul className={sectionBody}>
        {uploads.map((replay) => (
          <li key={replay.uploadId} className="flex h-8 items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-soft">{replay.fileName ?? 'replay'}</span>
            <span className="shrink-0 font-semibold text-text">{replayStatusText(replay)}</span>
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="mt-1 text-sm font-semibold text-text">
          {message}
        </p>
      )}
    </section>
  )
}

function Legends({ legends }: { legends: MyMatchesContract['record']['legends'] }) {
  if (legends.length === 0) return null

  return (
    <section className="max-2xl:hidden">
      <h2 className={sectionTitle}>Legends</h2>
      <ul className={sectionBody}>
        {legends.slice(0, 3).map((legend) => (
          <li key={legend.legendId} className="flex h-11 items-center gap-3">
            <img
              src={legendAvatarUrl(legend.legendKey)}
              alt=""
              className="size-8 shrink-0 rounded-md bg-raised object-cover object-top"
            />
            <span className="min-w-0 flex-1 truncate font-semibold text-strong">{legend.legendName}</span>
            <span className="font-mono text-sm whitespace-nowrap text-soft">
              {legend.wins}W {legend.games - legend.wins}L
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
