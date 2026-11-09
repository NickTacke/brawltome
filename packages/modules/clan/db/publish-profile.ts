import type { Database } from '@brawltome/foundation'
import { eq, sql } from 'drizzle-orm'
import type { ClanProfileWrite } from '../domain/guild-stats'
import type { ClanProvenance } from '../domain/provenance'
import { type ClanPublicationResult, isOlderThanLastSuccess } from '../domain/publication'
import type { ClanRefreshEffect } from '../domain/refresh-effect'
import { ensureClanIdentity } from './ensure-clan-identity'
import { excluded } from './excluded'
import { checkRefreshEffect, requireRefreshEffectApplied } from './refresh-effect-fence'
import { profileState, profiles } from './tables'
import type { Transaction } from './transaction'

export type ProfilePublication = {
  profile: ClanProfileWrite
  checkedAt: Date
  provenance: ClanProvenance
  effect?: ClanRefreshEffect
}

async function lockLastSuccessAt(transaction: Transaction, clanId: number): Promise<Date | null | undefined> {
  const [state] = await transaction
    .select({ lastSuccessAt: profileState.lastSuccessAt })
    .from(profileState)
    .where(eq(profileState.clanId, clanId))
    .for('update')

  return state?.lastSuccessAt
}

async function writeProfile(transaction: Transaction, profile: ClanProfileWrite): Promise<void> {
  await transaction
    .insert(profiles)
    .values(profile)
    .onConflictDoUpdate({
      target: profiles.clanId,
      set: {
        clanName: excluded(profiles.clanName),
        clanCreateDate: excluded(profiles.clanCreateDate),
        clanXp: excluded(profiles.clanXp),
        clanLifetimeXp: excluded(profiles.clanLifetimeXp),
        notice: excluded(profiles.notice),
        tags: excluded(profiles.tags),
        discordInviteCode: excluded(profiles.discordInviteCode),
        guildPoints: excluded(profiles.guildPoints),
        isRecruiting: excluded(profiles.isRecruiting),
      },
    })
}

// a newer failed check keeps its time and provenance; the success is recorded either way
async function writeSuccessfulCheck(transaction: Transaction, publication: ProfilePublication): Promise<void> {
  const { profile, checkedAt, provenance } = publication

  await transaction
    .insert(profileState)
    .values({
      clanId: profile.clanId,
      checkedAt,
      checkProvenance: provenance,
      lastSuccessAt: checkedAt,
      lastSuccessProvenance: provenance,
    })
    .onConflictDoUpdate({
      target: profileState.clanId,
      set: {
        checkedAt: sql`GREATEST(${profileState.checkedAt}, ${excluded(profileState.checkedAt)})`,
        checkProvenance: sql`CASE
          WHEN ${profileState.checkedAt} <= ${excluded(profileState.checkedAt)} THEN ${excluded(profileState.checkProvenance)}
          ELSE ${profileState.checkProvenance}
        END`,
        lastSuccessAt: excluded(profileState.lastSuccessAt),
        lastSuccessProvenance: excluded(profileState.lastSuccessProvenance),
      },
    })
}

/** publishProfile inside the caller's transaction, for a job that writes more alongside the profile. */
export async function writeProfilePublication(
  transaction: Transaction,
  publication: ProfilePublication,
): Promise<ClanPublicationResult> {
  const { profile, checkedAt, effect } = publication
  const preparation = await checkRefreshEffect(transaction, effect)

  if (preparation !== 'execute') return preparation

  await ensureClanIdentity(transaction, profile.clanId)
  const lastSuccessAt = await lockLastSuccessAt(transaction, profile.clanId)

  if (isOlderThanLastSuccess(checkedAt, lastSuccessAt)) {
    await requireRefreshEffectApplied(transaction, effect)

    return 'superseded'
  }

  await writeProfile(transaction, profile)
  await writeSuccessfulCheck(transaction, publication)
  await requireRefreshEffectApplied(transaction, effect)

  return 'applied'
}

/**
 * Stores a fetched clan profile, unless the lease was lost or a newer success is already stored. The lease check,
 * the writes and marking the lease applied share one transaction.
 */
export async function publishProfile(
  database: Database,
  publication: ProfilePublication,
): Promise<ClanPublicationResult> {
  return database.db.transaction((transaction) => writeProfilePublication(transaction, publication))
}
