import type { MyReplayContract } from '@brawltome/contracts'
import { Link, useRouter } from '@tanstack/react-router'
import { type ChangeEvent, type DragEvent, useEffect, useState } from 'react'
import { uploadReplays } from '../../server/replays'
import { ComingSoonPage } from '../coming-soon/ComingSoonPage'
import { isUnfinished, type MatchesPage, replayStatusText } from './matches-model'

// the api takes this many files per request
const filesPerRequest = 20
const refreshEveryMs = 3000

export function MatchesView({ page }: { page: MatchesPage }) {
  if (page.kind === 'comingSoon') return <ComingSoonPage slug="matches" />

  return (
    <div className="mx-auto max-w-3xl py-10">
      <h1 className="text-4xl font-black tracking-tight text-strong">Matches</h1>
      <p className="mt-2 max-w-xl text-soft">
        Upload your Brawlhalla replays and BrawlTome reads every match in them: damage, KOs, dodges, movement and more.
      </p>
      <div className="mt-8">
        <PageBody page={page} />
      </div>
    </div>
  )
}

function PageBody({ page }: { page: Exclude<MatchesPage, { kind: 'comingSoon' }> }) {
  if (page.kind === 'signedOut') {
    return (
      <a href={page.signInUrl} className="text-primary underline underline-offset-4">
        Sign in to upload your replays
      </a>
    )
  }

  if (!page.isVerified) {
    return (
      <p className="text-soft">
        Replays need to be your own matches, so first{' '}
        <a href="/account" className="text-primary underline underline-offset-4">
          link your Brawlhalla account with Steam
        </a>
        .
      </p>
    )
  }

  return (
    <>
      <UploadPanel />
      <MyReplays replays={page.replays} />
    </>
  )
}

function UploadPanel() {
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function upload(files: File[]) {
    const replays = files.filter((file) => file.name.endsWith('.replay'))

    if (replays.length === 0) return

    setIsUploading(true)
    setMessage(null)

    for (let start = 0; start < replays.length; start += filesPerRequest) {
      const form = new FormData()

      for (const file of replays.slice(start, start + filesPerRequest)) form.append('files', file, file.name)

      const answer = await uploadReplays({ data: form }).catch(() => ({ kind: 'failed' }) as const)

      if (answer.kind !== 'uploaded') {
        setMessage(
          answer.kind === 'notVerified'
            ? 'Link your account with Steam first.'
            : 'The upload didn’t go through. Please try again.',
        )

        break
      }
    }

    setIsUploading(false)
    await router.invalidate()
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    void upload([...event.dataTransfer.files])
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    void upload([...(event.target.files ?? [])])
    event.target.value = ''
  }

  return (
    <label
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex cursor-pointer flex-col items-center justify-center rounded-control border border-dashed border-line px-6 py-10 text-center transition-colors hover:bg-raised"
    >
      <span className="font-semibold text-strong">
        {isUploading ? 'Uploading…' : 'Drop .replay files here, or pick them'}
      </span>
      <span className="mt-1 text-sm text-soft">They’re in Documents/BrawlhallaReplays on Windows.</span>
      <input type="file" accept=".replay" multiple className="sr-only" onChange={onPick} disabled={isUploading} />
      {message && (
        <span role="alert" className="mt-3 text-sm font-medium text-red-400">
          {message}
        </span>
      )}
    </label>
  )
}

function MyReplays({ replays }: { replays: MyReplayContract[] }) {
  const router = useRouter()
  const hasUnfinished = replays.some(isUnfinished)

  // while something is still being read, the list checks again on its own
  useEffect(() => {
    if (!hasUnfinished) return

    const timer = setInterval(() => void router.invalidate(), refreshEveryMs)

    return () => clearInterval(timer)
  }, [hasUnfinished, router])

  if (replays.length === 0) return null

  return (
    <ul className="mt-8 divide-y divide-line/50 border-y border-line/50">
      {replays.map((replay) => (
        <li key={replay.uploadId} className="flex items-center justify-between gap-4 py-3">
          <span className="min-w-0 truncate text-text">{replay.fileName ?? 'replay'}</span>
          {replay.matchId ? (
            <Link
              to="/match/$id"
              params={{ id: replay.matchId }}
              className="shrink-0 text-primary underline underline-offset-4"
            >
              View match
            </Link>
          ) : (
            <span className="shrink-0 text-sm text-soft">{replayStatusText(replay)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
