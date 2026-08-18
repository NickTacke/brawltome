'use client'

import { Avatar, AvatarFallback, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import Link from 'next/link'
import { useState } from 'react'
import { ReplayReportView } from './ReplayReportView'
import { formatDuration } from './ReplayResultView'
import {
  type PreviewMatch,
  getPreviewAppearance,
  getPreviewMatch,
  getPreviewPlayer,
  previewMatches,
  previewMatchesForPlayer,
  replayReportFromPreview,
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

function PreviewShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Badge variant="outline">Preview data</Badge>
          <h1 className="mt-3 text-4xl font-black tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fixture-backed interface preview. No public records are being published.
          </p>
        </div>
        <Button asChild>
          <Link href="/matches?analyze=1">Analyze a real replay</Link>
        </Button>
      </header>
      {children}
    </main>
  )
}

function previewTimestamp(value: string): string {
  return `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC`
}

function winnerNames(match: PreviewMatch): string {
  return (
    match.participants
      .filter(({ teamId }) => teamId === match.winningTeamId)
      .map(({ playerId }) => getPreviewPlayer(playerId)?.name ?? 'Unknown player')
      .join(' and ') || 'Unknown player'
  )
}

function matchTeams(match: PreviewMatch) {
  const teams = new Map<string, PreviewMatch['participants'][number][]>()
  for (const participant of match.participants) {
    teams.set(participant.teamId, [...(teams.get(participant.teamId) ?? []), participant])
  }
  return [...teams].map(([id, participants]) => ({
    id,
    participants,
    score: participants.reduce((total, participant) => total + participant.score, 0),
    won: id === match.winningTeamId,
  }))
}

function participantNames(match: PreviewMatch): string {
  return matchTeams(match)
    .map(({ participants }) =>
      participants.map(({ playerId }) => getPreviewPlayer(playerId)?.name ?? playerId).join(' & '),
    )
    .join(' vs ')
}

function PreviewFeed({ notice }: { notice?: string }) {
  return (
    <PreviewShell title="Recent matches">
      {notice && <output className="rounded-md border border-border p-3 text-sm">{notice}</output>}
      <section className="grid gap-3" aria-label="Preview recent matches">
        {previewMatches.map((match) => (
          <Card key={match.id} className="border-border bg-card">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Match</p>
                  <h2 className="mt-1 text-xl font-black">{match.map}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {match.mode} · {formatDuration(match.durationMs)} · {previewTimestamp(match.playedAt)}
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/matches?match=${match.id}`}>View match</Link>
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2" aria-label={participantNames(match)}>
                {matchTeams(match).map((team) => (
                  <section key={team.id} className="rounded-md border border-border p-3">
                    <div className="mb-3 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          Team {team.id} score
                        </p>
                        <p className="font-mono text-2xl font-black tabular-nums">{team.score}</p>
                      </div>
                      {team.won && <Badge variant="outline">Winner {winnerNames(match)}</Badge>}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {team.participants.map(({ playerId }) => (
                        <Appearance key={playerId} playerId={playerId} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </PreviewShell>
  )
}

export function nextPreviewImageUrl(
  currentImageUrl: string | undefined,
  fallbackImageUrl: string | undefined,
): string | undefined {
  return currentImageUrl === fallbackImageUrl ? undefined : fallbackImageUrl
}

function AppearanceImage({
  primaryImageUrl,
  fallbackImageUrl,
  alt,
  initials,
}: {
  primaryImageUrl: string | undefined
  fallbackImageUrl: string | undefined
  alt: string
  initials: string
}) {
  const [imageUrl, setImageUrl] = useState(primaryImageUrl)
  if (!imageUrl) return <AvatarFallback className="rounded-md">{initials}</AvatarFallback>
  return (
    <img
      src={imageUrl}
      alt={alt}
      className="aspect-square h-full w-full rounded-md object-cover object-top"
      onError={() => setImageUrl(nextPreviewImageUrl(imageUrl, fallbackImageUrl))}
    />
  )
}

function Appearance({ playerId }: { playerId: string }) {
  const player = getPreviewPlayer(playerId)
  if (!player) return null
  const appearance = getPreviewAppearance(player)
  const primaryImageUrl = appearance.imageUrl ?? appearance.fallbackImageUrl ?? undefined
  const fallbackImageUrl = appearance.imageUrl ? (appearance.fallbackImageUrl ?? undefined) : undefined
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-12 w-12 rounded-md border border-border bg-muted">
        <AppearanceImage
          key={player.id}
          primaryImageUrl={primaryImageUrl}
          fallbackImageUrl={fallbackImageUrl}
          alt={appearance.name}
          initials={player.name.slice(0, 2).toUpperCase()}
        />
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

function PreviewMatchDetail({ matchId }: { matchId: string }) {
  const match = getPreviewMatch(matchId)
  if (!match) return <PreviewFeed notice="Preview match is unavailable." />
  return (
    <PreviewShell title="Match report">
      <Button asChild variant="ghost">
        <Link href="/matches">Back to feed</Link>
      </Button>
      <ReplayReportView report={replayReportFromPreview(match)} />
    </PreviewShell>
  )
}

function PreviewPlayerHistory({ playerId }: { playerId: string }) {
  const player = getPreviewPlayer(playerId)
  if (!player) return <PreviewFeed notice="Preview player is unavailable." />
  const matches = previewMatchesForPlayer(playerId)
  return (
    <PreviewShell title="Player history">
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
        {matches.map((match) => {
          const participant = match.participants.find(({ playerId: id }) => id === playerId)
          return (
            <Card key={match.id}>
              <CardHeader>
                <CardTitle>{match.map}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {match.mode} · {formatDuration(match.durationMs)} ·{' '}
                  {participant?.teamId === match.winningTeamId ? 'Win' : 'Loss'}
                </p>
              </CardHeader>
              <CardContent>
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
