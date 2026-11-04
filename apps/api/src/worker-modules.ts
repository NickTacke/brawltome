import { accountsModule } from '@brawltome/accounts'
import { clanModule } from '@brawltome/clan'
import { discoveryModule } from '@brawltome/discovery'
import type { BrawltomeModule } from '@brawltome/foundation'
import { playerModule } from '@brawltome/player'
import { rankingModule } from '@brawltome/ranking'
import { refreshOperationsModule } from '@brawltome/refresh-operations'
import { requestAdmissionModule } from '@brawltome/request-admission'
import { statisticsModule } from '@brawltome/statistics'

// the modules the operations worker loads
export const workerModules: readonly BrawltomeModule[] = [
  accountsModule,
  refreshOperationsModule,
  requestAdmissionModule,
  playerModule,
  clanModule,
  discoveryModule,
  rankingModule,
  statisticsModule,
]
