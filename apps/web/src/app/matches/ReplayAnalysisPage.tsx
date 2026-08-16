'use client'

import { publicApiUrl } from '@/lib/api-url'
import { signIn, useAccount } from '@/lib/auth'
import {
  REPLAY_UPLOAD_LIMIT_BYTES,
  type ReplayJobDetailContract,
  type ReplayJobSummaryContract,
  replayJobDetailSchema,
  replayJobSummarySchema,
} from '@brawltome/contracts'
import { getLegendById, getLevelById } from '@brawltome/game-data'
import { Upload } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

const statusLabel = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Complete',
  failed: 'Failed',
} as const

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function timelineX(timestampMs: number, durationMs: number): number {
  return 20 + Math.min(timestampMs / durationMs, 1) * 960
}

function ResultView({ job }: { job: ReplayJobDetailContract }) {
  if (!job.result) return null
  const { core } = job.result
  const replay = core.replay
  const metrics = new Map(core.native.players.map((player) => [player.slot, player]))
  const maxDamage = Math.max(...core.native.players.map(({ damageDealt }) => damageDealt), 1)
  const map = getLevelById(replay.mapId)
  const winningTeam = replay.outcome.winningTeamId

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Match summary">
        {[
          ['Duration', formatDuration(replay.durationMs)],
          ['Map', map?.displayName ?? `Map ${replay.mapId}`],
          ['Playlist', `#${replay.playlistId}`],
          ['Winner', winningTeam === null ? 'Draw' : `Team ${winningTeam}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wider">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h2 className="font-semibold">Players</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground bg-white/[0.02] text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 font-medium">Player</th>
                <th className="px-3 py-3 font-medium">Team</th>
                <th className="px-3 py-3 font-medium">Legend</th>
                <th className="px-3 py-3 text-right font-medium">KOs</th>
                <th className="px-3 py-3 text-right font-medium">Deaths</th>
                <th className="px-3 py-3 text-right font-medium">Damage</th>
                <th className="px-5 py-3 text-right font-medium">Dodges</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {replay.players.map((player) => {
                const native = metrics.get(player.slot)
                const legend = getLegendById(player.loadout.legendId)
                return (
                  <tr key={player.slot}>
                    <td className="px-5 py-3 font-medium">
                      {player.name}
                      {player.teamId === winningTeam && <span className="ml-2 text-amber-300">Winner</span>}
                    </td>
                    <td className="px-3 py-3">{player.teamId}</td>
                    <td className="px-3 py-3">{legend?.displayName ?? `#${player.loadout.legendId}`}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{native?.kos ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{native?.deaths ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{native?.damageDealt.toFixed(1) ?? '0'}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{native?.dodges ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <figure className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <figcaption className="font-semibold">Damage dealt</figcaption>
          <div className="mt-5 space-y-4">
            {replay.players.map((player) => {
              const damage = metrics.get(player.slot)?.damageDealt ?? 0
              return (
                <div key={player.slot}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>{player.name}</span>
                    <span className="tabular-nums">{damage.toFixed(1)}</span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${(damage / maxDamage) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </figure>

        <figure className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <figcaption className="font-semibold">KO timeline</figcaption>
          {replay.koTimeline.length === 0 ? (
            <p className="text-muted-foreground mt-5 text-sm">No KOs recorded.</p>
          ) : (
            <>
              <svg viewBox="0 0 1000 100" className="mt-5 h-24 w-full" aria-hidden="true">
                <line x1="20" x2="980" y1="50" y2="50" className="stroke-border" strokeWidth="4" />
                {replay.koTimeline.map((event, index) => (
                  <g key={`${event.timestampMs}-${event.victimSlot}-${index}`}>
                    <circle
                      cx={timelineX(event.timestampMs, replay.durationMs)}
                      cy="50"
                      r="10"
                      className="fill-primary"
                    />
                    <text
                      x={timelineX(event.timestampMs, replay.durationMs)}
                      y={index % 2 === 0 ? 25 : 86}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[24px]"
                    >
                      {formatDuration(event.timestampMs)}
                    </text>
                  </g>
                ))}
              </svg>
              <ol className="sr-only">
                {replay.koTimeline.map((event, index) => {
                  const scorer = replay.players.find(({ slot }) => slot === event.scoringSlot)?.name ?? 'Environment'
                  const victim = replay.players.find(({ slot }) => slot === event.victimSlot)?.name ?? 'Unknown player'
                  return (
                    <li key={`${event.timestampMs}-${event.victimSlot}-${index}`}>
                      {formatDuration(event.timestampMs)}: {scorer} knocked out {victim}.
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </figure>
      </div>

      <p className="text-muted-foreground text-xs">
        Replay-deterministic analysis from processor {core.provenance.processorVersion}. {core.limitations[0]?.text}
      </p>
    </div>
  )
}

export function ReplayAnalysisPage() {
  const { account, isLoading } = useAccount()
  const [jobs, setJobs] = useState<ReplayJobSummaryContract[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReplayJobDetailContract | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadJobs = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`${publicApiUrl}/api/replays`, { credentials: 'include', signal })
    if (!response.ok) throw new Error(`Replay list failed with status ${response.status}`)
    return replayJobSummarySchema.array().parse(await response.json())
  }, [])

  const loadSelected = useCallback(async (id: string) => {
    const response = await fetch(`${publicApiUrl}/api/replays/${id}`, { credentials: 'include' })
    if (!response.ok) throw new Error(`Replay status failed with status ${response.status}`)
    return replayJobDetailSchema.parse(await response.json())
  }, [])

  const hasActiveJobs = jobs.some(({ status }) => status === 'pending' || status === 'processing')
  useEffect(() => {
    if (!account) return
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const nextJobs = await loadJobs(controller.signal)
        if (!cancelled) {
          setJobs(nextJobs)
          setSelectedId((current) => current ?? nextJobs[0]?.id ?? null)
        }
      } catch {
        if (!cancelled) setError(hasActiveJobs ? 'Could not refresh replay jobs.' : 'Could not load replay jobs.')
      } finally {
        if (!cancelled && hasActiveJobs) timer = window.setTimeout(refresh, 2_000)
      }
    }
    void refresh()
    return () => {
      cancelled = true
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [account, hasActiveJobs, loadJobs])

  const selectedStatus = jobs.find(({ id }) => id === selectedId)?.status
  useEffect(() => {
    let cancelled = false
    setSelected(null)
    if (selectedId && selectedStatus) {
      void loadSelected(selectedId)
        .then((detail) => {
          if (!cancelled) setSelected(detail)
        })
        .catch(() => {
          if (!cancelled) setError('Could not load replay analysis.')
        })
    }
    return () => {
      cancelled = true
    }
  }, [loadSelected, selectedId, selectedStatus])

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || uploading) return
    if (file.size > REPLAY_UPLOAD_LIMIT_BYTES) {
      setError('Replay files must be 16 MiB or smaller.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const response = await fetch(`${publicApiUrl}/api/replays`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/octet-stream',
          'x-replay-file-name': encodeURIComponent(file.name),
        },
        body: file,
      })
      if (!response.ok) throw new Error(`Upload failed with status ${response.status}`)
      const job = replayJobSummarySchema.parse(await response.json())
      setJobs((current) => [job, ...current.filter(({ id }) => id !== job.id)])
      setSelectedId(job.id)
      setFile(null)
    } catch {
      setError('Could not upload this replay. Try again.')
    } finally {
      setUploading(false)
    }
  }

  if (isLoading) return <main className="mx-auto max-w-6xl px-6 py-12">Loading…</main>
  if (!account) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-3xl font-bold">Replay analysis</h1>
        <p className="text-muted-foreground mt-3">Sign in to upload and privately view your Brawlhalla replays.</p>
        <button
          type="button"
          onClick={signIn}
          className="bg-primary mt-6 cursor-pointer rounded-lg px-5 py-3 font-semibold text-white"
        >
          Sign in with Discord
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Replay analysis</h1>
        <p className="text-muted-foreground mt-2">
          Upload a format 268 replay. Processing normally finishes in a few minutes.
        </p>
      </div>

      <form onSubmit={upload} className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-6">
        <label htmlFor="replay-file" className="flex cursor-pointer flex-col items-center gap-3 text-center">
          <Upload className="text-muted-foreground h-8 w-8" />
          <span className="font-medium">{file?.name ?? 'Choose a .replay file'}</span>
          <span className="text-muted-foreground text-xs">Maximum 16 MiB</span>
        </label>
        <input
          id="replay-file"
          type="file"
          accept=".replay,application/octet-stream"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="submit"
          disabled={!file || uploading}
          className="bg-primary mx-auto mt-5 block cursor-pointer rounded-lg px-5 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : 'Analyze replay'}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {jobs.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Your replays</h2>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full min-w-2xl text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Replay
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Status
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Submitted
                  </th>
                  <th className="px-4 py-3 font-medium" scope="col">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className={selectedId === job.id ? 'bg-primary/10' : 'border-t border-white/[0.06]'}>
                    <th className="px-4 py-3 font-medium" scope="row">
                      <button
                        type="button"
                        onClick={() => setSelectedId(job.id)}
                        className="cursor-pointer hover:underline"
                      >
                        {job.fileName ?? 'Replay'}
                      </button>
                    </th>
                    <td className="px-4 py-3">{statusLabel[job.status]}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      <time dateTime={job.createdAt}>{job.createdAt.slice(0, 16).replace('T', ' ')} UTC</time>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      <time dateTime={job.updatedAt}>{job.updatedAt.slice(0, 16).replace('T', ' ')} UTC</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selected && selected.status !== 'completed' && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <p className="font-semibold">{statusLabel[selected.status]}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {selected.failure?.message ?? 'The replay is waiting for VM 104 and the Replay Processor.'}
          </p>
        </div>
      )}
      {selected && <ResultView job={selected} />}
    </main>
  )
}
