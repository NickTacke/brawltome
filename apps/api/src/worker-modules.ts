import { accountsModule } from '@brawltome/accounts'
import { clanModule } from '@brawltome/clan'
import { discoveryModule } from '@brawltome/discovery'
import type { BrawltomeModule } from '@brawltome/foundation'
import { playerModule } from '@brawltome/player'
import { queueModule } from '@brawltome/queue'
import { rankingModule } from '@brawltome/ranking'
import { requestAdmissionModule } from '@brawltome/request-admission'
import { statisticsModule } from '@brawltome/statistics'

export const workerModules: readonly BrawltomeModule[] = [
  accountsModule,
  queueModule,
  requestAdmissionModule,
  playerModule,
  clanModule,
  discoveryModule,
  rankingModule,
  statisticsModule,
]
