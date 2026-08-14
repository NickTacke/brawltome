'use client'

import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Card } from '@brawltome/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { type Bracket, type ComboEntry, COMBOS_1V1, COMBOS_2V2 } from './data'

const DIFFICULTY_TONE: Record<ComboEntry['difficulty'], string> = {
  Beginner: 'text-success border-success/40',
  Intermediate: 'text-primary border-primary/40',
  Advanced: 'text-danger border-danger/40',
}

export function CombosSection() {
  const [bracket, setBracket] = useState<Bracket>('1v1')
  const [showAll, setShowAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const combos = bracket === '1v1' ? COMBOS_1V1 : COMBOS_2V2
  const displayed = showAll ? combos : combos.slice(0, 4)
  const totalCombos = combos.reduce((sum, c) => sum + c.count, 0)

  const handleToggle = () => {
    if (showAll) ref.current?.scrollIntoView({ behavior: 'auto' })
    setShowAll(!showAll)
  }

  return (
    <div id="combos" ref={ref} className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <span aria-hidden="true">&#127919;</span> Combo Library
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-mono">
            {totalCombos} combos in {bracket}
          </span>
          <BracketToggle value={bracket} onChange={setBracket} />
        </div>
      </div>

      <Card className="overflow-hidden border-border bg-linear-to-br from-card to-background">
        {displayed.map((combo, i) => (
          <ComboRow key={`${combo.legendKey}-${combo.partner ?? ''}-${i}`} combo={combo} bracket={bracket} />
        ))}
      </Card>

      {combos.length > 4 && (
        <div className="flex justify-center mt-6">
          <Button variant="outline" onClick={handleToggle} className="gap-2">
            {showAll ? (
              <>
                Show Less <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show All Combos <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

function BracketToggle({ value, onChange }: { value: Bracket; onChange: (v: Bracket) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-bold">
      {(['1v1', '2v2'] as const).map((b) => {
        const active = b === value
        return (
          <button
            key={b}
            type="button"
            onClick={() => onChange(b)}
            className={`cursor-pointer rounded-md px-3 py-1 transition-colors ${
              active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {b}
          </button>
        )
      })}
    </div>
  )
}

function ComboRow({ combo, bracket }: { combo: ComboEntry; bracket: Bracket }) {
  const isTeam = bracket === '2v2' && !!combo.partner
  const slug = isTeam ? `${combo.legendKey}-${combo.partnerKey}` : combo.legendKey
  const href = `/learn/combos/${bracket}/${slug}`

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 p-4 transition-colors hover:bg-accent/30 border-b border-border/40 last:border-b-0"
    >
      <div className="flex shrink-0 items-center -space-x-3">
        <Avatar className="w-10 h-10 rounded-md border border-border bg-muted ring-2 ring-card">
          <AvatarImage
            src={`/images/legends/avatars/${combo.legendKey}.png`}
            alt={combo.legendName}
            className="object-cover object-top"
          />
          <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
            {combo.legendName.substring(0, 2)}
          </AvatarFallback>
        </Avatar>
        {isTeam && combo.partnerKey && (
          <Avatar className="w-10 h-10 rounded-md border border-border bg-muted ring-2 ring-card">
            <AvatarImage
              src={`/images/legends/avatars/${combo.partnerKey}.png`}
              alt={combo.partner}
              className="object-cover object-top"
            />
            <AvatarFallback className="text-[10px] uppercase font-bold text-muted-foreground rounded-md">
              {combo.partner?.substring(0, 2)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
            {combo.legendName}
            {isTeam && <span className="text-muted-foreground"> + {combo.partner}</span>}
          </h3>
          <Badge
            variant="outline"
            className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0 h-4 ${DIFFICULTY_TONE[combo.difficulty]}`}
          >
            {combo.difficulty}
          </Badge>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
          {combo.weapon && (
            <>
              <span className="text-foreground/80">{combo.weapon}</span>
              <span className="opacity-30">&bull;</span>
            </>
          )}
          <span className="italic text-muted-foreground">"{combo.highlight}"</span>
        </div>
      </div>

      <div className="flex items-baseline gap-1 shrink-0">
        <span className="text-lg font-black text-foreground leading-none">{combo.count}</span>
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">combos</span>
      </div>
    </Link>
  )
}
