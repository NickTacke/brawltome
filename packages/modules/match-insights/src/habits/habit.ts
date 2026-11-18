import type { Habit, HabitMoment, HabitOption } from '@brawltome/contracts'

// a habit is how often a player picked each option in one situation, and what the pick cost them

export type HabitSpec = {
  key: string
  situation: string
  layout?: Habit['layout']
  labels: Record<string, string>
  // which pick, at which share and sample size, is worth pointing out
  isFlagged: (top: HabitOption, share: number, total: number) => boolean
}

export const minimumSample = 8

function countOptions(labels: Record<string, string>, moments: HabitMoment[]): HabitOption[] {
  const options = Object.entries(labels).map(([key, label]) => ({ key, label, count: 0, punished: 0, costDamage: 0 }))

  for (const moment of moments) {
    const option = options.find((entry) => entry.key === moment.option)

    if (!option) continue

    option.count += 1
    option.punished += moment.costDamage > 0 ? 1 : 0
    option.costDamage += moment.costDamage
  }

  return options
}

// several moments can lead to the same punish; the last one before it takes the blame
function blameLastMoment(moments: HabitMoment[]): HabitMoment[] {
  return moments.map((moment, index) => {
    const isBlamedLater = moments
      .slice(index + 1)
      .some((later) => later.costStep !== null && later.costStep === moment.costStep)

    return isBlamedLater ? { ...moment, costDamage: 0, costStep: null } : moment
  })
}

function mostPicked(options: HabitOption[]): HabitOption | null {
  const ranked = [...options].sort((left, right) => right.count - left.count)

  return ranked[0] && ranked[0].count > 0 ? ranked[0] : null
}

export function makeHabit(spec: HabitSpec, everyMoment: HabitMoment[]): Habit {
  const moments = blameLastMoment(everyMoment)
  const options = countOptions(spec.labels, moments)
  const total = options.reduce((sum, option) => sum + option.count, 0)
  const top = mostPicked(options)
  const share = top ? top.count / total : 0

  return {
    key: spec.key,
    situation: spec.situation,
    unit: 'times',
    layout: spec.layout ?? 'bar',
    options,
    total,
    top,
    share,
    punished: options.reduce((sum, option) => sum + option.punished, 0),
    costDamage: options.reduce((sum, option) => sum + option.costDamage, 0),
    isFlagged: top !== null && spec.isFlagged(top, share, total),
    moments,
  }
}
