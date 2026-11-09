import { accountsModule } from '@brawltome/accounts'
import { clanModule } from '@brawltome/clan'
import { discoveryModule } from '@brawltome/discovery'
import type { BrawltomeModule } from '@brawltome/foundation'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { rankingModule } from '@brawltome/ranking'
import { replayAnalysisModule } from '@brawltome/replay-analysis'
import { requestAdmissionModule } from '@brawltome/request-admission'
import { statisticsModule } from '@brawltome/statistics'

// a const tuple, so the oRPC router keeps the type of each module's procedures
export const apiModules = [
  accountsModule,
  queueModule,
  requestAdmissionModule,
  playerModule,
  clanModule,
  discoveryModule,
  rankingModule,
  statisticsModule,
  replayAnalysisModule,
] as const satisfies readonly BrawltomeModule[]
