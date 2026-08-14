'use client'

import { Badge, Button, Card, CardContent } from '@brawltome/ui'
import { ChevronDown, ChevronUp, Play } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { type TutorialCategory, type TutorialEntry, TUTORIAL_CATEGORIES, TUTORIALS } from './data'

const DIFFICULTY_TONE: Record<TutorialEntry['difficulty'], string> = {
  Beginner: 'text-success border-success/40',
  Intermediate: 'text-primary border-primary/40',
  Advanced: 'text-danger border-danger/40',
}

/**
 * Tiny color dots per category — matches the section-marker pattern from
 * LegendCardExpanded ("w-1.5 h-1.5 rounded-full bg-blue-500"). Helps the eye
 * scan a grid of tutorial cards by category.
 */
const CATEGORY_DOT: Record<TutorialCategory, string> = {
  Movement: 'bg-blue-500',
  'Dodge reads': 'bg-purple-500',
  'Edge guards': 'bg-rose-500',
  Recovery: 'bg-emerald-500',
  Mindgame: 'bg-amber-500',
  'Team play': 'bg-cyan-500',
}

type Filter = 'All' | TutorialCategory
const VISIBLE_DEFAULT = 6

export function TutorialsSection() {
  const [filter, setFilter] = useState<Filter>('All')
  const [showAll, setShowAll] = useState(false)

  const filtered = filter === 'All' ? TUTORIALS : TUTORIALS.filter((t) => t.category === filter)
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_DEFAULT)

  return (
    <div id="tutorials" className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <span aria-hidden="true">&#128218;</span> Tutorials
        </h2>
        <span className="text-sm text-muted-foreground font-mono">
          {TUTORIALS.length} guides · {TUTORIAL_CATEGORIES.length - 1} categories
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TUTORIAL_CATEGORIES.map((cat) => {
          const active = cat === filter
          return (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setFilter(cat)
                setShowAll(false)
              }}
              className={`cursor-pointer rounded-md border px-3 py-1 text-xs font-bold transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((t) => (
          <TutorialCard key={t.slug} tutorial={t} />
        ))}
      </div>

      {filtered.length > VISIBLE_DEFAULT && (
        <div className="flex justify-center mt-2">
          <Button variant="outline" onClick={() => setShowAll(!showAll)} className="gap-2">
            {showAll ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Tutorials <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function TutorialCard({ tutorial }: { tutorial: TutorialEntry }) {
  return (
    <Link href={`/learn/tutorials/${tutorial.slug}`} className="group">
      <Card className="overflow-hidden border-border bg-linear-to-br from-card to-background h-full transition-colors group-hover:border-primary/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[tutorial.category]}`} aria-hidden="true" />
              <span>{tutorial.category}</span>
              <span className="opacity-30">&bull;</span>
              <span className="font-mono">{tutorial.duration}</span>
              {tutorial.hasVideo && (
                <>
                  <span className="opacity-30">&bull;</span>
                  <Play className="h-3 w-3 fill-current" />
                </>
              )}
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0 h-4 ${DIFFICULTY_TONE[tutorial.difficulty]}`}
            >
              {tutorial.difficulty}
            </Badge>
          </div>
          <h3 className="mt-3 text-base font-bold text-foreground leading-snug group-hover:text-primary transition-colors">
            {tutorial.title}
          </h3>
        </CardContent>
      </Card>
    </Link>
  )
}
