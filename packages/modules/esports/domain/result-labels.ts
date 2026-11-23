import { editionTitle, eventName } from './event-names'

export type LabelInput = { id: string; fullName: string; isOfficial: boolean; startTime: number; mode: string }

export type ResultLabel = { title: string; meta: string }

type Labelled = { result: LabelInput; label: ResultLabel }

function day(startTime: number): string {
  return new Date(startTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function firstLabel(result: LabelInput): ResultLabel {
  const { title, region, year } = eventName(result.fullName, result.isOfficial, result.startTime)

  return { title, meta: region ? `${region} ${year}` : String(year) }
}

const keyOf = (label: ResultLabel) => `${label.title}|${label.meta}`

function isUnique(labels: ResultLabel[]): boolean {
  return new Set(labels.map(keyOf)).size === labels.length
}

function groupBy<Item>(items: Item[], key: (item: Item) => string): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()

  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])

  return groups
}

// tiles that read the same say their mode ("2026 · 2v2"), then their edition ("Ignite"), and failing both their day
function candidates(group: Labelled[]): ResultLabel[][] {
  const byMode = group.map(({ result, label }) => ({ ...label, meta: `${label.meta} · ${result.mode}` }))

  const byEdition = group.map(({ result, label }) => ({
    ...label,
    title: editionTitle(result.fullName) ?? label.title,
  }))

  const byDay = group.map(({ result, label }) => ({ ...label, meta: `${day(result.startTime)} ${label.meta}` }))

  return [byMode, byEdition, byDay]
}

// a new label must also stay clear of every other tile, not only of the ones it was told apart from
function separate(group: Labelled[], takenKeys: Set<string>): ResultLabel[] {
  const isFree = (labels: ResultLabel[]) => isUnique(labels) && labels.every((label) => !takenKeys.has(keyOf(label)))
  const options = candidates(group)

  return options.find(isFree) ?? (options.at(-1) as ResultLabel[])
}

// a short label for every result in the list, no two of them the same
export function resultLabels(results: LabelInput[]): Map<string, ResultLabel> {
  const labelled = results.map((result) => ({ result, label: firstLabel(result) }))
  const groups = [...groupBy(labelled, ({ label }) => keyOf(label)).values()]

  const takenKeys = new Set(
    groups.filter((group) => group.length === 1).map((group) => keyOf(group[0]?.label as ResultLabel)),
  )

  const labels = new Map<string, ResultLabel>()

  for (const group of groups) {
    const separated = group.length === 1 ? group.map(({ label }) => label) : separate(group, takenKeys)

    for (const label of separated) takenKeys.add(keyOf(label))

    for (const [index, { result }] of group.entries()) labels.set(result.id, separated[index] as ResultLabel)
  }

  return labels
}
