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
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { Activity, Clock3, FileUp, History, LockKeyhole, Upload } from 'lucide-react'
import { type DragEvent, type FormEvent, useCallback, useEffect, useState } from 'react'
import { ReplayResultView } from './ReplayResultView'

type ReplayJobStatus = ReplayJobSummaryContract['status']

const statusLabel: Record<ReplayJobStatus, string> = {
  pending: 'Queued',
  processing: 'Analyzing',
  completed: 'Complete',
  failed: 'Failed',
}

const statusClass: Record<ReplayJobStatus, string> = {
  pending: 'border-border bg-muted text-muted-foreground',
  processing: 'border-primary/30 bg-primary/10 text-primary',
  completed: 'border-success/30 bg-success/10 text-success',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
}

function replayTimestamp(value: string): string {
  return `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC`
}

function ReplayHistory({
  jobs,
  selectedId,
  onSelect,
}: {
  jobs: ReplayJobSummaryContract[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <Card className="overflow-hidden border-border">
      <CardHeader className="border-b border-border/70 pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5 text-primary" aria-hidden="true" />
          Recent replays
        </CardTitle>
        <p className="text-sm text-muted-foreground">Your private match history, newest first.</p>
      </CardHeader>
      <CardContent className="p-0">
        {jobs.length === 0 ? (
          <div className="p-6 text-center">
            <Activity className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 font-semibold text-foreground">No matches yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Upload a replay to start your history.</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Replay</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {jobs.map((job) => (
                  <tr key={job.id} className={selectedId === job.id ? 'bg-primary/10' : 'hover:bg-muted/30'}>
                    <th className="p-0 align-top" scope="row">
                      <button
                        type="button"
                        onClick={() => onSelect(job.id)}
                        className="w-full cursor-pointer p-4 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="block truncate font-bold text-foreground">
                          {job.fileName ?? 'Brawlhalla replay'}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                          <Clock3 className="h-3 w-3" aria-hidden="true" />
                          {replayTimestamp(job.createdAt)}
                        </span>
                        {job.failure && (
                          <span className="mt-1 block text-xs font-normal text-destructive">{job.failure.message}</span>
                        )}
                      </button>
                    </th>
                    <td className="w-24 p-4 pl-0 text-right align-top">
                      <Badge variant="outline" className={`px-2 py-0.5 ${statusClass[job.status]}`}>
                        {statusLabel[job.status]}
                      </Badge>
                      <span className="mt-2 block text-[10px] text-muted-foreground">
                        Updated {job.updatedAt.slice(11, 16)} UTC
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ReplayAnalysisPage() {
  const { account, isLoading } = useAccount()
  const [jobs, setJobs] = useState<ReplayJobSummaryContract[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReplayJobDetailContract | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [loadingSelected, setLoadingSelected] = useState(false)
  const [dragging, setDragging] = useState(false)
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
  let uploadButtonLabel = 'Analyze replay'
  if (hasActiveJobs) uploadButtonLabel = 'Analysis in progress'
  else if (uploading) uploadButtonLabel = 'Uploading…'
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
      setLoadingSelected(true)
      void loadSelected(selectedId)
        .then((detail) => {
          if (!cancelled) setSelected(detail)
        })
        .catch(() => {
          if (!cancelled) setError('Could not load replay analysis.')
        })
        .finally(() => {
          if (!cancelled) setLoadingSelected(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [loadSelected, selectedId, selectedStatus])

  function chooseFile(nextFile: File | null) {
    if (nextFile && nextFile.size > REPLAY_UPLOAD_LIMIT_BYTES) {
      setFile(null)
      setError('Replay files must be 16 MiB or smaller.')
      return
    }
    setError(null)
    setFile(nextFile)
  }

  function dropReplay(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files[0] ?? null)
  }

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || uploading) return
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

  if (isLoading) {
    return <div className="animate-pulse py-12 text-sm text-muted-foreground">Loading matches…</div>
  }

  if (!account) {
    return (
      <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center py-12 text-center">
        <Badge variant="outline" className="gap-2 border-primary/30 bg-primary/5 text-primary">
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
          Private replay analysis
        </Badge>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-foreground sm:text-6xl">
          Turn matches into answers.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Upload a Brawlhalla replay to review damage, movement, knockouts, and equipment in one match report.
        </p>
        <Card className="mt-8 w-full border-border">
          <CardContent className="flex flex-col items-center p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileUp className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-xl font-bold">Sign in to upload replays</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your uploads and analysis history stay attached to your account.
            </p>
            <Button type="button" size="lg" onClick={signIn} className="mt-6">
              Sign in with Discord
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <div className="space-y-8 pb-10">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-foreground sm:h-14 sm:text-5xl">Replay analysis</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Upload a Brawlhalla replay to review damage, movement, knockouts, and equipment.
        </p>
      </header>

      <Card className={`overflow-hidden border-border ${dragging ? 'ring-2 ring-primary' : ''}`}>
        <CardContent className={jobs.length === 0 ? 'p-8 sm:p-10' : 'p-5'}>
          <form onSubmit={upload} className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <label
              htmlFor="replay-file"
              onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={dropReplay}
              className={`flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-lg border border-dashed p-4 transition-colors ${dragging ? 'border-primary bg-primary/10' : 'border-border bg-background/50 hover:border-primary/50'}`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-bold text-foreground">
                  {file?.name ?? 'Choose or drop a .replay file'}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {hasActiveJobs ? 'One replay is already being analyzed' : 'Format 268 · Maximum 16 MiB'}
                </span>
              </span>
            </label>
            <input
              id="replay-file"
              type="file"
              accept=".replay,application/octet-stream"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <Button type="submit" size="lg" disabled={!file || uploading || hasActiveJobs} className="shrink-0">
              {uploadButtonLabel}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div className="space-y-6">
        <ReplayHistory jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />

        <section aria-live="polite">
          {loadingSelected && (
            <Card className="animate-pulse">
              <CardContent className="p-8">
                <div className="h-5 w-40 rounded bg-muted" />
                <div className="mt-4 h-28 rounded bg-muted/60" />
              </CardContent>
            </Card>
          )}
          {!loadingSelected && selected && selected.status !== 'completed' && (
            <Card className="border-border">
              <CardContent className="flex items-start gap-4 p-6">
                <span className="relative mt-1 flex h-3 w-3 shrink-0">
                  {selected.status !== 'failed' && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
                  )}
                  <span
                    className={`relative inline-flex h-3 w-3 rounded-full ${selected.status === 'failed' ? 'bg-destructive' : 'bg-primary'}`}
                  />
                </span>
                <div>
                  <p className="font-bold text-foreground">{statusLabel[selected.status]}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected.failure?.message ??
                      'The replay worker is preparing your match report. This normally takes a few minutes.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {!loadingSelected && selected && <ReplayResultView job={selected} />}
          {!loadingSelected && !selected && jobs.length === 0 && (
            <Card className="border-dashed border-border">
              <CardContent className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
                <h2 className="mt-4 text-xl font-bold text-foreground">Your next match report starts here</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Upload a replay above. Recent matches will stay above the full analysis.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}
