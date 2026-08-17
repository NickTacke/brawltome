'use client'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import Link from 'next/link'
import { formatDuration } from './ReplayResultView'
import { getPreviewPlayer, previewMatches } from './matches-preview-fixtures'

export function MatchesPreview({
  matchId,
  playerId,
  notice,
}: {
  matchId?: string
  playerId?: string
  notice?: string
}) {
  if (matchId) return <PreviewMatchDetail matchId={matchId} />
  if (playerId) return <PreviewPlayerHistory playerId={playerId} />
  return <PreviewFeed notice={notice} />
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="outline">Preview data</Badge>
          <h1 className="mt-3 text-4xl font-black tracking-tight">Recent matches</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fixture-backed interface preview. No public records are being published.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/matches?analyze=1">Analyze replay</Link>
        </Button>
      </header>
      {children}
    </main>
  )
}

function previewTimestamp(value: string): string {
  return `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC`
}

function PreviewFeed({ notice }: { notice?: string }) {
  return (
    <PreviewShell>
      {notice && <output className="rounded-md border border-border p-3 text-sm">{notice}</output>}
      <section className="grid gap-4" aria-label="Preview recent matches">
        {previewMatches.map((match) => {
          const winner = getPreviewPlayer(match.winnerPlayerId)
          return (
            <Card key={match.id}>
              <CardHeader>
                <CardTitle>{match.map}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {match.mode} · {formatDuration(match.durationMs)} · {previewTimestamp(match.playedAt)} · Winner{' '}
                  {winner?.name ?? 'Unknown player'}
                </p>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {match.participants.map(({ playerId }) => getPreviewPlayer(playerId)?.name ?? playerId).join(' vs ')}
                </span>
                <Button asChild size="sm">
                  <Link href={`/matches?match=${match.id}`}>View match</Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </section>
    </PreviewShell>
  )
}

function PreviewMatchDetail({ matchId }: { matchId: string }) {
  return <PreviewFeed notice={`Preview match ${matchId} is unavailable.`} />
}

function PreviewPlayerHistory({ playerId }: { playerId: string }) {
  return <PreviewFeed notice={`Preview player ${playerId} is unavailable.`} />
}
