'use client'

import { Badge, Button, Card } from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { type WeaponEntry, WEAPONS } from './data'

const DIFFICULTY_TONE: Record<WeaponEntry['difficulty'], string> = {
  Beginner: 'text-success border-success/40',
  Intermediate: 'text-primary border-primary/40',
  Advanced: 'text-danger border-danger/40',
}

export function WeaponsSection() {
  const [showAll, setShowAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const displayed = showAll ? WEAPONS : WEAPONS.slice(0, 6)

  const handleToggle = () => {
    if (showAll) ref.current?.scrollIntoView({ behavior: 'auto' })
    setShowAll(!showAll)
  }

  return (
    <div id="weapons" ref={ref} className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <span aria-hidden="true">&#9876;</span> Weapons
        </h2>
        <span className="text-sm text-muted-foreground font-mono">
          {WEAPONS.length} weapons · combos · dodge reads
        </span>
      </div>

      <Card className="overflow-hidden border-border bg-linear-to-br from-card to-background">
        {displayed.map((weapon) => (
          <WeaponRow key={weapon.slug} weapon={weapon} />
        ))}
      </Card>

      {WEAPONS.length > 6 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggle} className="gap-2">
            {showAll ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Weapons <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function WeaponRow({ weapon }: { weapon: WeaponEntry }) {
  const totalGuides = weapon.trueCombos + weapon.dodgeReads + weapon.techGuides

  return (
    <Link
      href={`/learn/weapons/${weapon.slug}`}
      className="group flex items-center gap-4 p-4 transition-colors hover:bg-accent/30 border-b border-border/40 last:border-b-0"
    >
      <div className="h-12 w-12 shrink-0">
        <img
          src={`/images/weapons/${weapon.name}.png`}
          alt={weapon.displayName}
          className="h-full w-full object-contain drop-shadow-md"
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
            {weapon.displayName}
          </h3>
          <Badge
            variant="outline"
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0 h-4 ${DIFFICULTY_TONE[weapon.difficulty]}`}
          >
            {weapon.difficulty}
          </Badge>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
          <span>
            <span className="text-foreground font-bold">{weapon.trueCombos}</span> true combos
          </span>
          <span className="opacity-30">&bull;</span>
          <span>
            <span className="text-foreground font-bold">{weapon.dodgeReads}</span> dodge reads
          </span>
          <span className="opacity-30">&bull;</span>
          <span>
            <span className="text-foreground font-bold">{weapon.techGuides}</span> tech
          </span>
        </div>
      </div>

      <div className="flex items-baseline gap-1 shrink-0">
        <span className="text-lg font-black text-foreground leading-none">{totalGuides}</span>
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">guides</span>
      </div>
    </Link>
  )
}
