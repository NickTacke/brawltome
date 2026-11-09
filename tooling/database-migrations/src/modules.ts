import { accountsModule } from '@brawltome/accounts'
import { clanModule } from '@brawltome/clan'
import { discoveryModule } from '@brawltome/discovery'
import type { BrawltomeModule } from '@brawltome/foundation'
import { playerModule } from '@brawltome/player'
import { refreshOperationsModule } from '@brawltome/queue'
import { rankingModule } from '@brawltome/ranking'
import { replayAnalysisModule } from '@brawltome/replay-analysis'
import { requestAdmissionModule } from '@brawltome/request-admission'
import { statisticsModule } from '@brawltome/statistics'
import { legacyV2Module } from './legacy-v2'

// every module whose schema the database holds, whichever process loads it
export const migrationModules: readonly BrawltomeModule[] = [
  accountsModule,
  refreshOperationsModule,
  requestAdmissionModule,
  playerModule,
  clanModule,
  discoveryModule,
  rankingModule,
  statisticsModule,
  replayAnalysisModule,
  legacyV2Module,
]
