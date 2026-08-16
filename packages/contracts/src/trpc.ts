import type {
  AnyTRPCRootTypes,
  TRPCBuiltRouter,
  TRPCDefaultErrorShape,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from '@trpc/server'
import type { z } from 'zod'
import type {
  accountPreferencesSchema,
  accountViewSchema,
  pinnedPlayerOrderInputSchema,
  playerShortcutsSchema,
  primaryPlayerVerificationStateSchema,
  savedPlayerInputSchema,
  savedPlayerOrderInputSchema,
  savedPlayersSchema,
} from './account'
import type {
  careerWeaponUsageHistoryOutputSchema,
  careerWeaponUsageInputSchema,
  careerWeaponUsageOutputSchema,
} from './career-weapon-usage'
import type {
  clanByIdInputSchema,
  clanRefreshInputSchema,
  clanRefreshResponseSchema,
  discordClanRefreshInputSchema,
  nullableClanProfileSchema,
  playerClanMembershipSchema,
} from './clan'
import type { contractProofSchema } from './contract-proof'
import type { discoverySearchInputSchema, discoverySearchOutputSchema } from './discovery'
import type { leaderboardInputSchema, leaderboardOutputSchema } from './leaderboard'
import type { nullablePlayerCareerProfileSchema } from './player-career'
import type { nullablePlayerRankedProfileSchema } from './player-ranked'
import type { nullablePlayerReferenceSchema, playerReferenceByIdInputSchema } from './player-reference'
import type {
  discordPlayerRefreshInputSchema,
  playerRefreshInputSchema,
  playerRefreshResponseSchema,
} from './refresh-outcome'
import type { legendMetaHistoryOutputSchema, legendMetaInputSchema, legendMetaOutputSchema } from './statistics'

type Output<TSchema extends z.ZodType> = z.output<TSchema>
type ProcedureDefinition<TInput, TOutput> = { input: TInput; output: TOutput; meta: unknown }
type Query<TInput, TOutput> = TRPCQueryProcedure<ProcedureDefinition<TInput, TOutput>>
type Mutation<TInput, TOutput> = TRPCMutationProcedure<ProcedureDefinition<TInput, TOutput>>

type ClientRootTypes = Omit<AnyTRPCRootTypes, 'ctx' | 'meta' | 'errorShape' | 'transformer'> & {
  ctx: AnyTRPCRootTypes['ctx']
  meta: object
  errorShape: TRPCDefaultErrorShape
  transformer: true
}

type AppRouterRecord = {
  account: {
    current: Query<void, Output<typeof accountViewSchema>>
    preferences: Query<void, Output<typeof accountPreferencesSchema>>
    updatePreferences: Mutation<Output<typeof accountPreferencesSchema>, Output<typeof accountPreferencesSchema>>
    primaryPlayer: Query<void, Output<typeof primaryPlayerVerificationStateSchema>>
    playerShortcuts: Query<void, Output<typeof playerShortcutsSchema>>
    savedPlayers: Query<void, Output<typeof savedPlayersSchema>>
    savePlayer: Mutation<Output<typeof savedPlayerInputSchema>, Output<typeof savedPlayersSchema>>
    removeSavedPlayer: Mutation<Output<typeof savedPlayerInputSchema>, Output<typeof savedPlayersSchema>>
    reorderSavedPlayers: Mutation<Output<typeof savedPlayerOrderInputSchema>, Output<typeof savedPlayersSchema>>
    pinSavedPlayer: Mutation<Output<typeof savedPlayerInputSchema>, Output<typeof savedPlayersSchema>>
    unpinSavedPlayer: Mutation<Output<typeof savedPlayerInputSchema>, Output<typeof savedPlayersSchema>>
    reorderPinnedPlayers: Mutation<Output<typeof pinnedPlayerOrderInputSchema>, Output<typeof savedPlayersSchema>>
  }
  contractProof: {
    get: Query<void, Output<typeof contractProofSchema>>
  }
  clan: {
    byId: Query<Output<typeof clanByIdInputSchema>, Output<typeof nullableClanProfileSchema>>
    membershipByPlayerId: Query<
      Output<typeof playerReferenceByIdInputSchema>,
      Output<typeof playerClanMembershipSchema> | null
    >
    refresh: Mutation<Output<typeof clanRefreshInputSchema>, Output<typeof clanRefreshResponseSchema>>
    refreshDiscord: Mutation<Output<typeof discordClanRefreshInputSchema>, Output<typeof clanRefreshResponseSchema>>
  }
  player: {
    referenceById: Query<Output<typeof playerReferenceByIdInputSchema>, Output<typeof nullablePlayerReferenceSchema>>
    rankedById: Query<Output<typeof playerReferenceByIdInputSchema>, Output<typeof nullablePlayerRankedProfileSchema>>
    careerById: Query<Output<typeof playerReferenceByIdInputSchema>, Output<typeof nullablePlayerCareerProfileSchema>>
    requestRefresh: Mutation<Output<typeof playerRefreshInputSchema>, Output<typeof playerRefreshResponseSchema>>
    refreshDiscord: Mutation<Output<typeof discordPlayerRefreshInputSchema>, Output<typeof playerRefreshResponseSchema>>
    refresh: Mutation<{ id: number; turnstileToken: string }, { isRefreshing: boolean }>
  }
  search: {
    local: Query<Output<typeof discoverySearchInputSchema>, Output<typeof discoverySearchOutputSchema>>
  }
  leaderboard: {
    get: Query<Output<typeof leaderboardInputSchema>, Output<typeof leaderboardOutputSchema>>
  }
  statistics: {
    legendMeta: Query<Output<typeof legendMetaInputSchema>, Output<typeof legendMetaOutputSchema>>
    legendMetaHistory: Query<Output<typeof legendMetaInputSchema>, Output<typeof legendMetaHistoryOutputSchema>>
    careerWeaponUsage: Query<Output<typeof careerWeaponUsageInputSchema>, Output<typeof careerWeaponUsageOutputSchema>>
    careerWeaponUsageHistory: Query<
      Output<typeof careerWeaponUsageInputSchema>,
      Output<typeof careerWeaponUsageHistoryOutputSchema>
    >
  }
  status: {
    health: Query<void, { status: 'healthy' }>
    discordReady: Query<void, { status: 'ready' }>
  }
}

export type AppRouter = TRPCBuiltRouter<ClientRootTypes, AppRouterRecord>
