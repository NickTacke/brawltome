import { describe, expect, mock, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import { EVENT_TIMELINE_EXTENSION_URI, MATCH_SUMMARY_EXTENSION_URI, NATIVE_EXTENSION_URI } from '@brawltome/contracts'
import type { ReplayAnalysisJobs } from '@brawltome/replay-analysis'
import { createReplayAnalysisRoutes, createReplayBridgeRoutes } from '../src/routes/replay-analysis.routes'

const accountId = 'f00efdc1-5cbd-44c7-a2ac-47f98f1c0f39'
const jobId = '1b2f7508-8e9c-4b1a-950f-d60fabe27176'
const leaseToken = randomUUID()

function dependencies() {
  const create = mock(async () => ({
    id: jobId,
    status: 'pending' as const,
    fileName: 'match.replay',
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    failure: null,
  }))
  const accounts = {
    authenticate: mock(async () => ({
      status: 'signedIn' as const,
      extended: false,
      account: { id: accountId, displayName: 'Player', avatarUrl: null, createdAt: new Date() },
    })),
  } as unknown as Accounts
  const jobs = { create } as unknown as ReplayAnalysisJobs
  return { accounts, jobs, create }
}

describe('replay upload routes', () => {
  test('requires the web origin and authenticated session before storing bounded bytes', async () => {
    const deps = dependencies()
    const app = createReplayAnalysisRoutes({ ...deps, webOrigin: 'https://brawltome.app' })

    const forbidden = await app.request('/replays', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Uint8Array.of(1),
    })
    expect(forbidden.status).toBe(403)
    expect(deps.create).not.toHaveBeenCalled()

    const accepted = await app.request('/replays', {
      method: 'POST',
      headers: {
        cookie: 'brawltome_session=session-token',
        origin: 'https://brawltome.app',
        'content-type': 'application/octet-stream',
        'x-replay-file-name': 'match.replay',
      },
      body: Uint8Array.of(1, 2, 3),
    })
    expect(accepted.status).toBe(202)
    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        fileName: 'match.replay',
        replayBytes: Uint8Array.of(1, 2, 3),
      }),
    )
  })

  test('rejects a declared oversized replay without reading it', async () => {
    const deps = dependencies()
    const app = createReplayAnalysisRoutes({ ...deps, webOrigin: 'https://brawltome.app' })
    const response = await app.request('/replays', {
      method: 'POST',
      headers: {
        cookie: 'brawltome_session=session-token',
        origin: 'https://brawltome.app',
        'content-type': 'application/octet-stream',
        'content-length': String(16 * 1024 * 1024 + 1),
      },
      body: Uint8Array.of(1),
    })
    expect(response.status).toBe(413)
    expect(deps.create).not.toHaveBeenCalled()
  })
})

describe('replay bridge routes', () => {
  test('binds an event extension to the submitted core', async () => {
    const nativePlayer = {
      airDodges: 0,
      airJumps: 0,
      airTimeMs: 0,
      clashes: 0,
      damageDealt: 0,
      damageTaken: 0,
      dashJumps: 0,
      dashes: 0,
      deaths: 0,
      dodges: 0,
      groundTimeMs: 1,
      jumps: 0,
      kos: 0,
      slot: 0,
      suicides: 0,
      teamDamageDealt: 0,
      teamDamageTaken: 0,
      teamKos: 0,
      wallTimeMs: 0,
    }
    const loadout = {
      colorId: 0,
      costumeId: 0,
      koEffectId: 0,
      legendId: 1,
      morphWeapon2: false,
      sidekickId: 0,
      stanceId: 0,
      weaponSkin1Id: 0,
      weaponSkin2Id: 0,
    }
    const digest = `sha256:${'a'.repeat(64)}`
    const core = {
      limitations: [{ code: 'test', scopes: ['/'], text: 'Test limitation.' }],
      native: { players: [nativePlayer, { ...nativePlayer, slot: 1 }] },
      provenance: {
        collector: 'test',
        gameBuild: '24744406',
        parityClaim: 'replay-deterministic',
        patchDigest: digest,
        patchId: 'test',
        patchedArtifactDigest: digest,
        pristineArtifactDigest: digest,
        processorArtifactDigest: digest,
        processorVersion: 'test',
        qualificationManifestDigest: digest,
        qualificationProfile: 'test',
        replaySourceDigest: digest,
      },
      replay: {
        durationMs: 1,
        format: 269,
        koTimeline: [],
        mapId: 1,
        matchSettings: { lives: 3, scoreToWin: 0, teamMode: false },
        online: true,
        outcome: { winningTeamId: null },
        players: [
          { entityId: 0, loadout, name: 'One', playerId: null, score: 0, slot: 0, teamId: 0 },
          { entityId: 1, loadout, name: 'Two', playerId: null, score: 0, slot: 1, teamId: 1 },
        ],
        playlistId: 1,
        randomSeed: 1,
        replayDigest: digest,
        teamScores: [],
      },
    }
    const coreDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify({ core, schemaVersion: 1 }))
      .digest('hex')}`
    const extensionIdentity = {
      inputCoreDigest: coreDigest,
      inputCoreSchemaVersion: 1,
      limitations: [],
      producerArtifactDigest: digest,
      producerVersion: 'test',
      qualificationManifestDigest: digest,
      schemaVersion: 1,
    }
    const summaryPlayer = {
      airDodgeShare: null,
      airJumpShare: null,
      airTimeShare: null,
      damageDealtPerKo: null,
      damageDealtPerMinute: null,
      damageTakenPerDeath: null,
      damageTakenPerMinute: null,
      dashesPerMinute: null,
      dashJumpShare: null,
      deathsPerMinute: null,
      dodgesPerMinute: null,
      friendlyDamageDealtShare: null,
      friendlyDamageTakenShare: null,
      groundTimeShare: null,
      jumpsPerMinute: null,
      koDeathRatio: null,
      kosPerMinute: null,
      slot: 0,
      wallTimeShare: null,
    }
    const result = {
      core,
      coreDigest,
      extensions: {
        [NATIVE_EXTENSION_URI]: {
          ...extensionIdentity,
          producerUri: NATIVE_EXTENSION_URI,
          data: {
            players: [
              { payload: { Equipment: { Sword: { TimeHeld: 1 } }, Sequence: [] }, slot: 0 },
              { payload: { Equipment: { Sword: { TimeHeld: 1 } }, Sequence: [] }, slot: 1 },
            ],
          },
        },
        [MATCH_SUMMARY_EXTENSION_URI]: {
          ...extensionIdentity,
          producerUri: MATCH_SUMMARY_EXTENSION_URI,
          data: {
            equipment: [],
            players: [summaryPlayer, { ...summaryPlayer, slot: 1 }],
            powers: [],
            rateDenominatorMs: 0,
          },
        },
        [EVENT_TIMELINE_EXTENSION_URI]: {
          ...extensionIdentity,
          producerUri: EVENT_TIMELINE_EXTENSION_URI,
          data: {
            clock: { basis: 'native-replay', quantumMs: 16, replayOffsetMs: 0 },
            players: [
              { dodges: [], hits: [], moves: [], slot: 0 },
              { dodges: [], hits: [], moves: [], slot: 1 },
            ],
          },
        },
      },
      schemaVersion: 1,
    }
    const complete = mock(async () => 'completed' as const)
    const jobs = { complete } as unknown as ReplayAnalysisJobs
    const secret = 'bridge-secret-that-is-at-least-32-bytes'
    const app = createReplayBridgeRoutes({ jobs, secret })

    const accepted = await app.request(`/${jobId}/result`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        'x-replay-lease-token': leaseToken,
      },
      body: JSON.stringify(result),
    })
    expect(accepted.status).toBe(204)
    expect(complete).toHaveBeenCalledTimes(1)

    result.extensions[EVENT_TIMELINE_EXTENSION_URI].inputCoreDigest = `sha256:${'f'.repeat(64)}`
    const rejected = await app.request(`/${jobId}/result`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
        'x-replay-lease-token': leaseToken,
      },
      body: JSON.stringify(result),
    })
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ error: 'invalid_extension_digest' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  test('returns and requires the lease fence for state transitions', async () => {
    const claim = mock(async () => ({
      id: jobId,
      leaseToken,
      replayBytes: Uint8Array.of(1, 2, 3),
      replayDigest: `sha256:${'a'.repeat(64)}`,
    }))
    const release = mock(async (_id: string, token: string) => token === leaseToken)
    const renew = mock(async (_id: string, token: string) => token === leaseToken)
    const jobs = { claim, release, renew } as unknown as ReplayAnalysisJobs
    const secret = 'bridge-secret-that-is-at-least-32-bytes'
    const app = createReplayBridgeRoutes({ jobs, secret })

    const claimed = await app.request('/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(claimed.status).toBe(200)
    expect(claimed.headers.get('x-replay-lease-seconds')).toBe('600')
    expect(claimed.headers.get('x-replay-lease-token')).toBe(leaseToken)
    expect(new Uint8Array(await claimed.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))

    const renewed = await app.request(`/${jobId}/renew`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-replay-lease-token': leaseToken },
    })
    expect(renewed.status).toBe(204)
    expect(renew).toHaveBeenCalledWith(jobId, leaseToken, 600)

    const staleRelease = await app.request(`/${jobId}/release`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'x-replay-lease-token': '11111111-1111-4111-8111-111111111111',
      },
    })
    expect(staleRelease.status).toBe(409)

    const currentRelease = await app.request(`/${jobId}/release`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-replay-lease-token': leaseToken },
    })
    expect(currentRelease.status).toBe(204)
    expect(release).toHaveBeenLastCalledWith(jobId, leaseToken)
  })
})
