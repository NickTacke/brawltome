'use client'

import { Button, Card } from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { type PlayerData, parseNum } from '../shared'
import { LegendCard } from './LegendCard'
import { SortControls } from './SortControls'
import { type LegendSortKey, type RankedLegend, sortLegends } from './utils'

interface LegendSectionProps {
  allLegends: PlayerData[]
  rankedLegends: PlayerData[]
}

export function LegendSection({ allLegends, rankedLegends }: LegendSectionProps) {
  const [showAllLegends, setShowAllLegends] = useState(false)
  const [expandedLegendId, setExpandedLegendId] = useState<number | null>(null)
  const [openedLegendIds, setOpenedLegendIds] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<LegendSortKey>('xp')
  const legendsRef = useRef<HTMLDivElement>(null)

  const toggleLegend = (id: number) => {
    if (expandedLegendId === id) {
      setExpandedLegendId(null)
      return
    }
    setOpenedLegendIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setExpandedLegendId(id)
  }

  const sortedLegends = useMemo(() => {
    const legendByCanonicalId = new Map<number, PlayerData>()
    const canonicalLegends: RankedLegend[] = allLegends.map((legend: PlayerData) => {
      const ranked = rankedLegends.find((r: PlayerData) => r.legendId === legend.legendId)
      legendByCanonicalId.set(legend.legendId, legend)
      return {
        legendId: legend.legendId,
        games: legend.games ?? 0,
        wins: legend.wins ?? 0,
        matchTime: parseNum(legend.matchTime),
        xp: legend.xp ?? 0,
        level: legend.level ?? 0,
        elo: ranked?.rating ?? 0,
        peakElo: ranked?.peakRating ?? 0,
      }
    })
    return sortLegends(canonicalLegends, sortKey)
      .map((c) => legendByCanonicalId.get(c.legendId))
      .filter((l): l is PlayerData => l !== undefined)
  }, [allLegends, rankedLegends, sortKey])

  const displayedLegends = showAllLegends ? sortedLegends : sortedLegends.slice(0, 5)

  const handleToggleLegends = () => {
    if (showAllLegends) {
      legendsRef.current?.scrollIntoView({ behavior: 'auto' })
    }
    setShowAllLegends(!showAllLegends)
  }

  if (allLegends.length === 0) return null

  return (
    <div id="legends-section" ref={legendsRef} className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground">Legend Statistics</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-mono">Played: {allLegends.length}</span>
          <SortControls sortKey={sortKey} onChange={setSortKey} />
        </div>
      </div>

      <Card className="overflow-hidden border-border">
        {displayedLegends.map((legend: PlayerData) => (
          <LegendCard
            key={legend.legendId}
            legend={legend}
            rankedLegend={rankedLegends.find((r: PlayerData) => r.legendId === legend.legendId)}
            isExpanded={expandedLegendId === legend.legendId}
            hasOpened={openedLegendIds.has(legend.legendId)}
            onToggle={toggleLegend}
          />
        ))}
      </Card>

      {allLegends.length > 5 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggleLegends} className="gap-2">
            {showAllLegends ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Legends <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
