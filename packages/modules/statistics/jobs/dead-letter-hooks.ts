import {
  type DeadLetterHooks,
  type EffectDescriber,
  lockEffectOperation,
  type ReplayGuard,
  statisticsCollectionKinds,
} from '@brawltome/queue'
import { hasStatisticsCollectionSeal, readStatisticsEffects, readStatisticsPublicationEffects } from '../db/effects'

// a publication that read the collection has sealed it, and replaying it would change what that publication read
const requireCollectionUnsealed: ReplayGuard = async (transaction, target) => {
  await lockEffectOperation(transaction, target.effectOperationId)

  if (await hasStatisticsCollectionSeal(transaction, target.effectOperationId)) {
    throw new Error('Statistics collection replay is sealed by publication validation')
  }
}

const describeCollectionEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  statisticsEffects: await readStatisticsEffects(transaction, effectOperationId),
})

const describePublicationEffects: EffectDescriber = async (transaction, effectOperationId) => ({
  statisticsPublicationEffects: await readStatisticsPublicationEffects(transaction, effectOperationId),
})

export const statisticsDeadLetterHooks: DeadLetterHooks = {
  replayGuards: new Map(statisticsCollectionKinds.map((kind) => [kind, requireCollectionUnsealed])),
  describeEffects: new Map([
    ...statisticsCollectionKinds.map((kind): [string, EffectDescriber] => [kind, describeCollectionEffects]),
    ['statistics-publication', describePublicationEffects],
    ['statistics-legend-meta-publication', describePublicationEffects],
  ]),
}
