import { type PlayerAppearance, resolvePlayerAppearance } from '@brawltome/game-data'
import { type ReplayReport, safeRatio } from './replay-report'

export type PreviewPlayer = {
  readonly id: string
  readonly name: string
  readonly legendId: number
  readonly skinId: number
}

export type PreviewPositioning = {
  readonly air: number
  readonly ground: number
  readonly wall: number
}

export type PreviewParticipant = {
  readonly playerId: string
  readonly teamId: string
  readonly score: number
  readonly kos: number
  readonly deaths: number
  readonly damageDealt: number
  readonly damageTaken: number
  readonly positioning: PreviewPositioning
}

export type PreviewMatch = {
  readonly id: string
  readonly playedAt: string
  readonly map: string
  readonly mode: 'Ranked 1v1' | 'Ranked 2v2'
  readonly durationMs: number
  readonly winningTeamId: string
  readonly participants: readonly PreviewParticipant[]
  readonly knockouts: readonly {
    readonly timestampMs: number
    readonly scorerPlayerId: string | null
    readonly victimPlayerId: string
  }[]
  readonly events: readonly {
    readonly timestampMs: number
    readonly kind: 'unsupported'
    readonly label: 'Unsupported event'
  }[]
}

export const previewPlayers = [
  { id: 'preview-knight', name: 'AxeMender', legendId: 11, skinId: 351 },
  { id: 'preview-bodvar', name: 'BlueMammoth', legendId: 3, skinId: 999_999 },
  { id: 'preview-orion', name: 'StarLancer', legendId: 5, skinId: 999_999 },
  { id: 'preview-cassidy', name: 'QuickDraw', legendId: 4, skinId: 999_999 },
] as const satisfies readonly PreviewPlayer[]

export const previewMatches = [
  {
    id: 'preview-final',
    playedAt: '2026-08-17T19:40:00.000Z',
    map: 'Small Brawlhaven',
    mode: 'Ranked 1v1',
    durationMs: 113_296,
    winningTeamId: '1',
    participants: [
      {
        playerId: 'preview-knight',
        teamId: '1',
        score: 3,
        kos: 3,
        deaths: 1,
        damageDealt: 512.4,
        damageTaken: 381.2,
        positioning: { air: 0.45, ground: 0.54, wall: 0.01 },
      },
      {
        playerId: 'preview-bodvar',
        teamId: '2',
        score: 1,
        kos: 1,
        deaths: 3,
        damageDealt: 381.2,
        damageTaken: 512.4,
        positioning: { air: 0.39, ground: 0.59, wall: 0.02 },
      },
    ],
    knockouts: [{ timestampMs: 96_000, scorerPlayerId: null, victimPlayerId: 'preview-bodvar' }],
    events: [{ timestampMs: 64_000, kind: 'unsupported', label: 'Unsupported event' }],
  },
  {
    id: 'preview-team',
    playedAt: '2026-08-17T18:15:00.000Z',
    map: 'Mammoth Fortress',
    mode: 'Ranked 2v2',
    durationMs: 164_000,
    winningTeamId: '1',
    participants: [
      {
        playerId: 'preview-knight',
        teamId: '1',
        score: 2,
        kos: 2,
        deaths: 1,
        damageDealt: 441.8,
        damageTaken: 330.1,
        positioning: { air: 0.51, ground: 0.47, wall: 0.02 },
      },
      {
        playerId: 'preview-orion',
        teamId: '1',
        score: 2,
        kos: 2,
        deaths: 2,
        damageDealt: 410.3,
        damageTaken: 390.7,
        positioning: { air: 0.48, ground: 0.5, wall: 0.02 },
      },
      {
        playerId: 'preview-bodvar',
        teamId: '2',
        score: 1,
        kos: 1,
        deaths: 2,
        damageDealt: 352.7,
        damageTaken: 428.6,
        positioning: { air: 0.42, ground: 0.55, wall: 0.03 },
      },
      {
        playerId: 'preview-cassidy',
        teamId: '2',
        score: 1,
        kos: 1,
        deaths: 2,
        damageDealt: 368.1,
        damageTaken: 423.5,
        positioning: { air: 0.44, ground: 0.54, wall: 0.02 },
      },
    ],
    knockouts: [],
    events: [],
  },
  {
    id: 'preview-rematch',
    playedAt: '2026-08-17T17:05:00.000Z',
    map: 'Miami Dome',
    mode: 'Ranked 1v1',
    durationMs: 98_000,
    winningTeamId: '2',
    participants: [
      {
        playerId: 'preview-knight',
        teamId: '1',
        score: 2,
        kos: 2,
        deaths: 3,
        damageDealt: 427.6,
        damageTaken: 466.9,
        positioning: { air: 0.47, ground: 0.51, wall: 0.02 },
      },
      {
        playerId: 'preview-bodvar',
        teamId: '2',
        score: 3,
        kos: 3,
        deaths: 2,
        damageDealt: 466.9,
        damageTaken: 427.6,
        positioning: { air: 0.4, ground: 0.58, wall: 0.02 },
      },
    ],
    knockouts: [],
    events: [],
  },
] as const satisfies readonly PreviewMatch[]

export function getPreviewPlayer(id: string): PreviewPlayer | undefined {
  return previewPlayers.find((player) => player.id === id)
}

export function getPreviewMatch(id: string): PreviewMatch | undefined {
  return previewMatches.find((match) => match.id === id)
}

export function previewMatchesForPlayer(id: string): readonly PreviewMatch[] {
  return previewMatches.filter((match) => match.participants.some(({ playerId }) => playerId === id))
}

export function getPreviewAppearance(player: PreviewPlayer): PlayerAppearance {
  return resolvePlayerAppearance(player.legendId, player.skinId)
}

export function replayReportFromPreview(match: PreviewMatch): ReplayReport {
  const playersById = new Map<string, PreviewPlayer>(previewPlayers.map((player) => [player.id, player]))
  const winnerNames = match.participants.flatMap(({ playerId, teamId }) => {
    const name = playersById.get(playerId)?.name
    return teamId === match.winningTeamId && name ? [name] : []
  })
  const teams = new Map<string, { id: string; playerSlots: number[]; score: number; won: boolean }>()
  for (const [slot, participant] of match.participants.entries()) {
    const team = teams.get(participant.teamId)
    if (team) {
      team.playerSlots.push(slot)
      team.score += participant.score
    } else {
      teams.set(participant.teamId, {
        id: participant.teamId,
        playerSlots: [slot],
        score: participant.score,
        won: participant.teamId === match.winningTeamId,
      })
    }
  }
  const teamList = [...teams.values()]
  const nameAtSlot = (slot: number) => {
    const participant = match.participants[slot]
    return participant ? (playersById.get(participant.playerId)?.name ?? participant.playerId) : 'Unknown player'
  }

  return {
    source: 'preview',
    title: teamList.map(({ playerSlots }) => playerSlots.map(nameAtSlot).join(' & ')).join(' vs '),
    mapName: match.map,
    mode: match.mode,
    durationMs: match.durationMs,
    playedAt: match.playedAt,
    analyzedAt: null,
    fileName: null,
    gameBuild: null,
    provenance: null,
    winnerLabel: winnerNames.join(' & ') || `Team ${match.winningTeamId}`,
    teams: teamList,
    players: match.participants.flatMap((participant, slot) => {
      const player = playersById.get(participant.playerId)
      if (!player) return []

      return [
        {
          slot,
          name: player.name,
          profileHref: `/matches?player=${player.id}`,
          teamId: participant.teamId,
          score: participant.score,
          won: participant.teamId === match.winningTeamId,
          appearance: getPreviewAppearance(player),
          combat: {
            kos: participant.kos,
            deaths: participant.deaths,
            suicides: null,
            clashes: null,
            damageDealt: participant.damageDealt,
            damageTaken: participant.damageTaken,
            teamDamageDealt: null,
            teamDamageTaken: null,
            damageDealtPerMinute: safeRatio(participant.damageDealt * 60_000, match.durationMs),
            damageDealtPerKo: safeRatio(participant.damageDealt, participant.kos),
            damageTakenPerDeath: safeRatio(participant.damageTaken, participant.deaths),
            koDeathRatio: safeRatio(participant.kos, participant.deaths),
          },
          movement: {
            dodges: null,
            dashes: null,
            jumps: null,
            dashJumps: null,
            dodgesPerMinute: null,
            dashesPerMinute: null,
            jumpsPerMinute: null,
            dashJumpsPerMinute: null,
            airDodgeShare: null,
            airJumpShare: null,
            dashJumpShare: null,
            groundTimeShare: participant.positioning.ground,
            airTimeShare: participant.positioning.air,
            wallTimeShare: participant.positioning.wall,
          },
          equipment: null,
          powers: null,
        },
      ]
    }),
    knockouts: [...match.knockouts]
      .sort((left, right) => left.timestampMs - right.timestampMs)
      .map(({ timestampMs, scorerPlayerId, victimPlayerId }) => ({
        timestampMs,
        scorerName: scorerPlayerId === null ? null : (playersById.get(scorerPlayerId)?.name ?? null),
        victimName: playersById.get(victimPlayerId)?.name ?? 'Unknown player',
      })),
    capabilities: { eventTimeline: false, dodgeDirections: false, engagements: false },
    limitations: [],
  }
}
