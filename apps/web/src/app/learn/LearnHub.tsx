'use client'

import { useMe } from '@/lib/auth'
import { Skeleton } from '@brawltome/ui'
import { useSearchParams } from 'next/navigation'

import { CombosSection } from './CombosSection'
import { LearnHero } from './LearnHero'
import { type AuthView, PreviewToggle } from './PreviewToggle'
import { TutorialsSection } from './TutorialsSection'
import { WeaponsSection } from './WeaponsSection'
import { COMBOS_1V1, COMBOS_2V2, TUTORIALS, WEAPONS } from './data'

function resolveView(user: ReturnType<typeof useMe>['user'], override: string | null): AuthView {
  if (override === 'signed-out' || override === 'unlinked' || override === 'linked') return override
  if (!user) return 'signed-out'
  if (user.playerLink?.status !== 'linked') return 'unlinked'
  return 'linked'
}

export function LearnHub() {
  const { user, isLoading } = useMe()
  const search = useSearchParams()
  const override = search.get('as')
  const view = resolveView(user, override)

  if (isLoading && !override) {
    return (
      <div className="space-y-8 pt-2">
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-72 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-10 pb-12">
      <LearnHubHeader />
      <LearnHero view={view} username={user?.username ?? 'NickTacke'} />
      <WeaponsSection />
      <CombosSection />
      <TutorialsSection />
      <PreviewToggle activeOverride={override} />
    </div>
  )
}

function LearnHubHeader() {
  const totalGuides = WEAPONS.reduce((s, w) => s + w.trueCombos + w.dodgeReads + w.techGuides, 0) + TUTORIALS.length
  const totalCombos = COMBOS_1V1.reduce((s, c) => s + c.count, 0) + COMBOS_2V2.reduce((s, c) => s + c.count, 0)

  return (
    <div id="overview" className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl sm:text-5xl sm:h-14 font-black text-foreground tracking-tight">Learn</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>Curated guides for ranked Brawlhalla.</span>
          <span className="opacity-30">&bull;</span>
          <span>
            <span className="font-mono text-foreground">{totalGuides}</span> guides
          </span>
          <span className="opacity-30">&bull;</span>
          <span>
            <span className="font-mono text-foreground">{totalCombos}</span> combos
          </span>
          <span className="opacity-30">&bull;</span>
          <span>
            <span className="font-mono text-foreground">{WEAPONS.length}</span> weapons
          </span>
        </div>
      </div>
    </div>
  )
}
