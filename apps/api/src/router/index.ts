import type { AppRouter as ContractAppRouter } from '@brawltome/contracts'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import { router } from '../trpc/trpc'
import { accountRouter } from './account.router'
import { clanRouter } from './clan.router'
import { contractProofRouter } from './contract-proof.router'
import { leaderboardRouter } from './leaderboard.router'
import { playerRouter } from './player.router'
import { searchRouter } from './search.router'
import { statisticsRouter } from './statistics.router'
import { statusRouter } from './status.router'

export const appRouter = router({
  account: accountRouter,
  status: statusRouter,
  contractProof: contractProofRouter,
  player: playerRouter,
  clan: clanRouter,
  search: searchRouter,
  leaderboard: leaderboardRouter,
  statistics: statisticsRouter,
}) satisfies ContractAppRouter

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
  ? true
  : false
type Assert<Condition extends true> = Condition
export type AppRouterContractProof = Assert<
  Equal<inferRouterInputs<typeof appRouter>, inferRouterInputs<ContractAppRouter>> extends true
    ? Equal<inferRouterOutputs<typeof appRouter>, inferRouterOutputs<ContractAppRouter>>
    : false
>
