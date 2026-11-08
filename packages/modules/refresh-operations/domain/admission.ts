import { createHash } from 'node:crypto'
import { type AdmissionConfig, type BackgroundWorkClass, backgroundWorkClasses, workClasses } from '../model'

export type AdmissionCreditRow = {
  work_class: BackgroundWorkClass
  credit: string | number
}

export function validateAdmissionConfig(config: AdmissionConfig): AdmissionConfig {
  const integer = (value: number, name: string, minimum: number, maximum: number) => {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
    }
  }

  integer(config.totalConcurrency, 'totalConcurrency', 2, 10_000)
  integer(config.interactiveReservation, 'interactiveReservation', 1, config.totalConcurrency - 1)
  for (const workClass of workClasses) {
    integer(config.classConcurrency[workClass], `classConcurrency.${workClass}`, 1, config.totalConcurrency)
  }

  if (config.classConcurrency.interactive < config.interactiveReservation) {
    throw new Error('classConcurrency.interactive must cover interactiveReservation')
  }

  for (const workClass of backgroundWorkClasses) {
    integer(config.backgroundWeights[workClass], `backgroundWeights.${workClass}`, 1, 10_000)
  }

  return config
}

function admissionConfigDocument(config: AdmissionConfig) {
  return {
    totalConcurrency: config.totalConcurrency,
    interactiveReservation: config.interactiveReservation,
    classConcurrency: Object.fromEntries(
      workClasses.map((workClass) => [workClass, config.classConcurrency[workClass]]),
    ),
    backgroundWeights: Object.fromEntries(
      backgroundWorkClasses.map((workClass) => [workClass, config.backgroundWeights[workClass]]),
    ),
  }
}

export function admissionConfigHash(config: AdmissionConfig): {
  document: ReturnType<typeof admissionConfigDocument>
  hash: string
} {
  const document = admissionConfigDocument(config)

  return { document, hash: createHash('sha256').update(JSON.stringify(document)).digest('hex') }
}

export function chooseBackgroundClass(
  eligible: readonly BackgroundWorkClass[],
  credits: readonly AdmissionCreditRow[],
  config: AdmissionConfig,
): { selected: BackgroundWorkClass; nextCredits: Map<BackgroundWorkClass, number> } {
  const stored = new Map(credits.map((row) => [row.work_class, Number(row.credit)]))
  const nextCredits = new Map<BackgroundWorkClass, number>()
  let selected = eligible[0]
  let selectedScore = Number.NEGATIVE_INFINITY
  let totalWeight = 0

  for (const workClass of eligible) {
    const weight = config.backgroundWeights[workClass]

    totalWeight += weight
    const score = (stored.get(workClass) ?? 0) + weight

    nextCredits.set(workClass, score)
    if (score > selectedScore) {
      selected = workClass
      selectedScore = score
    }
  }

  nextCredits.set(selected, (nextCredits.get(selected) ?? 0) - totalWeight)

  return { selected, nextCredits }
}
