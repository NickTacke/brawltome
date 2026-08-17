'use client'

import { Avatar, AvatarFallback, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import Link from 'next/link'
import { formatDuration } from './ReplayResultView'
import {
  getPreviewAppearance,
  getPreviewMatch,
  getPreviewPlayer,
  previewMatches,
  previewMatchesForPlayer,
} from './matches-preview-fixtures'

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

function Appearance({ playerId }: { playerId: string }) {
  const player = getPreviewPlayer(playerId)
  if (!player) return null
  const appearance = getPreviewAppearance(player)
  const imageUrl = appearance.imageUrl ?? appearance.fallbackImageUrl ?? undefined
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-12 w-12 rounded-md border border-border bg-muted">
        {imageUrl && <img src={imageUrl} alt={appearance.name} className="rounded-md object-cover object-top" />}
        <AvatarFallback className="rounded-md">{player.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div>
        <Link href={`/matches?player=${player.id}`} className="font-bold hover:text-primary">
          {player.name}
        </Link>
        <p className="text-xs text-muted-foreground">{appearance.name}</p>
      </div>
    </div>
  )
}

function positioningText({ air, ground, wall }: { air: number; ground: number; wall: number }): string {
  return `Air ${(air * 100).toFixed(1)}% · Ground ${(ground * 100).toFixed(1)}% · Wall ${(wall * 100).toFixed(1)}%`
}

function PreviewMatchDetail({ matchId }: { matchId: string }) {
  const match = getPreviewMatch(matchId)
  if (!match) return <PreviewFeed notice="Preview match is unavailable." />
  const winner = getPreviewPlayer(match.winnerPlayerId)
  return (
    <PreviewShell>
      <Button asChild variant="ghost">
        <Link href="/matches">Back to feed</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>{match.map}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {match.mode} · {formatDuration(match.durationMs)} · Winner {winner?.name ?? 'Unknown player'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {match.participants.map((participant) => (
            <section key={participant.playerId} className="rounded-lg border border-border p-4">
              <Appearance playerId={participant.playerId} />
              <p className="mt-3 text-sm">
                Score {participant.score} · KOs {participant.kos} · Deaths {participant.deaths}
              </p>
              <p className="text-sm">
                Dealt {participant.damageDealt.toFixed(1)} · Taken {participant.damageTaken.toFixed(1)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{positioningText(participant.positioning)}</p>
            </section>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Knockout timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {match.knockouts.length === 0 ? (
            <p>No knockouts were recorded.</p>
          ) : (
            <ol className="space-y-2">
              {match.knockouts.map((knockout) => {
                const scorer = knockout.scorerPlayerId && getPreviewPlayer(knockout.scorerPlayerId)?.name
                const victim = getPreviewPlayer(knockout.victimPlayerId)?.name ?? 'Unknown player'
                return (
                  <li key={`${knockout.timestampMs}-${knockout.victimPlayerId}`}>
                    {formatDuration(knockout.timestampMs)} · <strong>{scorer ?? 'Unknown scorer'}</strong> knocked out{' '}
                    {victim}
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>
      {match.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional events</CardTitle>
          </CardHeader>
          <CardContent>
            {match.events.map((event) => (
              <p key={`${event.timestampMs}-${event.kind}`}>
                {formatDuration(event.timestampMs)} · {event.label}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </PreviewShell>
  )
}

function PreviewPlayerHistory({ playerId }: { playerId: string }) {
  const player = getPreviewPlayer(playerId)
  if (!player) return <PreviewFeed notice="Preview player is unavailable." />
  const matches = previewMatchesForPlayer(playerId)
  return (
    <PreviewShell>
      <Button asChild variant="ghost">
        <Link href="/matches">Back to feed</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Player preview</CardTitle>
        </CardHeader>
        <CardContent>
          <Appearance playerId={playerId} />
        </CardContent>
      </Card>
      <section className="grid gap-4" aria-label={`${player.name} preview match history`}>
        {matches.map((match) => (
          <Card key={match.id}>
            <CardHeader>
              <CardTitle>{match.map}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {match.mode} · {formatDuration(match.durationMs)} · {match.winnerPlayerId === playerId ? 'Win' : 'Loss'}
              </p>
            </CardHeader>
            <CardContent>
              <Button asChild size="sm">
                <Link href={`/matches?match=${match.id}`}>View match</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </PreviewShell>
  )
}
