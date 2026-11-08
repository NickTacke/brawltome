import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, lte, notInArray, or, type SQL, sql } from 'drizzle-orm'
import type { ClanMemberWrite } from '../domain/guild-members'
import type { ClanProvenance } from '../domain/provenance'
import { type ClanPublicationResult, isOlderThanLastSuccess } from '../domain/publication'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { ensureClanIdentity } from './ensure-clan-identity'
import { excluded } from './excluded'
import { checkRefreshEffect, requireRefreshEffectApplied } from './refresh-effect-fence'
import { members, rosterState } from './tables'
import type { Transaction } from './transaction'

export type RosterPublication = {
  clanId: number
  members: ClanMemberWrite[]
  checkedAt: Date
  provenance: ClanProvenance
  effect?: ClanRefreshEffect
}

// imported rows were never observed, so any fetched roster may replace them
function isObservedNoLaterThan(observedAt: Date | SQL): SQL | undefined {
  return or(isNull(members.observedAt), lte(members.observedAt, observedAt))
}

async function lockLastSuccessAt(transaction: Transaction, clanId: number): Promise<Date | null | undefined> {
  const [state] = await transaction
    .select({ lastSuccessAt: rosterState.lastSuccessAt })
    .from(rosterState)
    .where(eq(rosterState.clanId, clanId))
    .for('update')

  return state?.lastSuccessAt
}

// a member observed after this check stays, because a newer roster put it there
async function removeLeftMembers(transaction: Transaction, publication: RosterPublication): Promise<void> {
  const { clanId, checkedAt } = publication
  const memberIds = publication.members.map(({ brawlhallaId }) => brawlhallaId)
  const isInClan = eq(members.clanId, clanId)
  const hasLeft = memberIds.length === 0 ? undefined : notInArray(members.brawlhallaId, memberIds)

  await transaction.delete(members).where(and(isInClan, hasLeft, isObservedNoLaterThan(checkedAt)))
}

// a player moves to this clan, or is updated in it, only if no newer roster has placed them already
async function writeMembers(transaction: Transaction, publication: RosterPublication): Promise<void> {
  const { clanId, checkedAt } = publication

  for (const member of publication.members) {
    await transaction
      .insert(members)
      .values({ clanId, ...member, observedAt: checkedAt })
      .onConflictDoUpdate({
        target: members.brawlhallaId,
        set: {
          clanId: excluded(members.clanId),
          name: excluded(members.name),
          rank: excluded(members.rank),
          joinDate: excluded(members.joinDate),
          xp: excluded(members.xp),
          guildPoints: excluded(members.guildPoints),
          observedAt: excluded(members.observedAt),
        },
        setWhere: isObservedNoLaterThan(excluded(members.observedAt)),
      })
  }
}

// a newer failed check keeps its time and provenance; the success is recorded either way
async function writeSuccessfulCheck(transaction: Transaction, publication: RosterPublication): Promise<void> {
  const { clanId, checkedAt, provenance } = publication

  await transaction
    .insert(rosterState)
    .values({
      clanId,
      checkedAt,
      checkProvenance: provenance,
      lastSuccessAt: checkedAt,
      lastSuccessProvenance: provenance,
    })
    .onConflictDoUpdate({
      target: rosterState.clanId,
      set: {
        checkedAt: sql`GREATEST(${rosterState.checkedAt}, ${excluded(rosterState.checkedAt)})`,
        checkProvenance: sql`CASE
          WHEN ${rosterState.checkedAt} IS NULL OR ${rosterState.checkedAt} <= ${excluded(rosterState.checkedAt)}
            THEN ${excluded(rosterState.checkProvenance)}
          ELSE ${rosterState.checkProvenance}
        END`,
        lastSuccessAt: excluded(rosterState.lastSuccessAt),
        lastSuccessProvenance: excluded(rosterState.lastSuccessProvenance),
      },
    })
}

/**
 * Replaces a clan's stored members with a fetched roster, unless the lease was lost or a newer success is already
 * stored. The lease check, the writes and marking the lease applied share one transaction, so the whole roster
 * changes when it commits.
 */
export async function publishRoster(
  database: Database,
  publication: RosterPublication,
): Promise<ClanPublicationResult> {
  const { clanId, checkedAt, effect } = publication

  return database.db.transaction(async (transaction) => {
    const preparation = await checkRefreshEffect(transaction, effect)

    if (preparation !== 'execute') return preparation

    await ensureClanIdentity(transaction, clanId)
    const lastSuccessAt = await lockLastSuccessAt(transaction, clanId)

    if (isOlderThanLastSuccess(checkedAt, lastSuccessAt)) {
      await requireRefreshEffectApplied(transaction, effect)

      return 'superseded'
    }

    await removeLeftMembers(transaction, publication)
    await writeMembers(transaction, publication)
    await writeSuccessfulCheck(transaction, publication)
    await requireRefreshEffectApplied(transaction, effect)

    return 'applied'
  })
}
