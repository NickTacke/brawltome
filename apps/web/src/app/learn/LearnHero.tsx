'use client'

import { signIn } from '@/lib/auth'
import { getRankBanner } from '@/components/player/shared'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { ArrowRight, ChevronRight, Lock, Play } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MOCK_PATH, PREVIEW_PATH_BY_TIER, RANK_PICKER_TIERS } from './data'
import type { AuthView } from './PreviewToggle'

interface LearnHeroProps {
  view: AuthView
  username: string
}

export function LearnHero({ view, username }: LearnHeroProps) {
  const nextStep = useMemo(() => MOCK_PATH.steps.find((s) => s.status === 'next'), [])

  return (
    <Card className="bg-linear-to-br from-card to-background border-border relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent"
      />
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <span aria-hidden="true">&#127919;</span> Your Climb Path
          </CardTitle>
          <HeroStatusBadge view={view} />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {view === 'linked' ? <LinkedTopRow username={username} /> : <PreviewTopRow />}
        <PathStepsList previewLocked={view !== 'linked'} />

        {view === 'linked' && nextStep && <ContinueCta nextStep={nextStep} />}
        {view !== 'linked' && <PreviewCta view={view} />}
      </CardContent>
    </Card>
  )
}

function HeroStatusBadge({ view }: { view: AuthView }) {
  if (view === 'linked') {
    return (
      <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        Live · Linked
      </Badge>
    )
  }
  if (view === 'unlinked') {
    return (
      <Badge variant="outline" className="text-xs font-mono text-primary border-primary/40 gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
        Link to track live
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1.5">
      Preview
    </Badge>
  )
}

/* ─────────── Top row: banners + username + inline progress ─────────── */

function LinkedTopRow({ username }: { username: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
      <RankPair fromRank={MOCK_PATH.fromRank} fromLabel={MOCK_PATH.fromLabel} toRank={MOCK_PATH.toRank} toLabel={MOCK_PATH.toLabel} />

      <div className="flex-1 min-w-0 sm:pl-4 sm:border-l sm:border-border/50">
        <div className="truncate text-2xl sm:text-3xl font-black text-foreground tracking-tight leading-none">
          {username}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground font-mono">
          <span className="text-foreground font-bold">{MOCK_PATH.done}</span>
          <span className="text-muted-foreground/60"> of {MOCK_PATH.total}</span> done
          <span className="mx-1.5 opacity-30">&bull;</span>
          <span className="text-foreground font-bold">{MOCK_PATH.progressPct}%</span> to {MOCK_PATH.toLabel}
        </div>
        <ProgressBar percent={MOCK_PATH.progressPct} />
      </div>
    </div>
  )
}

function PreviewTopRow() {
  const [tier, setTier] = useState<keyof typeof PREVIEW_PATH_BY_TIER>('Gold')
  const path = PREVIEW_PATH_BY_TIER[tier]

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
      <RankPair fromRank={path.fromRank} fromLabel={path.fromLabel} toRank={path.toRank} toLabel={path.toLabel} />

      <div className="flex-1 min-w-0 sm:pl-4 sm:border-l sm:border-border/50 space-y-2">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Pick your rank</div>
        <div className="flex flex-wrap gap-1">
          {RANK_PICKER_TIERS.map((t) => {
            const active = t === tier
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t as keyof typeof PREVIEW_PATH_BY_TIER)}
                className={`cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
                }`}
              >
                {t}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RankPair({ fromRank, fromLabel, toRank, toLabel }: { fromRank: string; fromLabel: string; toRank: string; toLabel: string }) {
  return (
    <div className="flex items-center gap-3 shrink-0">
      <RankBanner rank={fromRank} label={fromLabel} />
      <ArrowRight className="h-5 w-5 text-muted-foreground/40 shrink-0" />
      <RankBanner rank={toRank} label={toLabel} muted />
    </div>
  )
}

function RankBanner({ rank, label, muted = false }: { rank: string; label: string; muted?: boolean }) {
  return (
    <div className="w-12 sm:w-14 shrink-0">
      <img
        src={getRankBanner(rank)}
        alt={label}
        className={`w-full h-auto object-contain drop-shadow-md ${muted ? 'opacity-60' : ''}`}
      />
      <div className="mt-1 text-center text-[10px] font-bold text-foreground leading-tight">{label}</div>
    </div>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="mt-2 relative w-full h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} aria-hidden="true" />
    </div>
  )
}

/* ─────────── Path steps (single-line compact rows) ─────────── */

function PathStepsList({ previewLocked }: { previewLocked: boolean }) {
  const steps = MOCK_PATH.steps.map((s) => (previewLocked ? { ...s, status: 'todo' as const } : s))

  return (
    <div className="border-t border-border/50 pt-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
          Path guides <span className="font-mono text-muted-foreground/60">· {steps.length}</span>
        </div>
        <Link
          href="/learn/path"
          className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          View full path <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {steps.map((step, idx) => (
          <PathStepItem key={step.title} step={step} index={idx + 1} />
        ))}
      </ol>
    </div>
  )
}

interface StepProps {
  step: { title: string; href: string; status: 'done' | 'next' | 'todo'; category: string }
  index: number
}

function PathStepItem({ step, index }: StepProps) {
  const isNext = step.status === 'next'
  const isDone = step.status === 'done'

  const wrapperClass = isNext
    ? 'border-primary/40 bg-primary/[0.06] hover:bg-primary/[0.10]'
    : 'border-border/30 bg-background/40 hover:bg-background/60'

  const titleClass = isNext ? 'text-foreground font-bold' : isDone ? 'text-foreground' : 'text-muted-foreground'

  const dotClass = isDone
    ? 'bg-success'
    : isNext
      ? 'bg-primary ring-2 ring-primary/20'
      : 'bg-muted-foreground/20'

  return (
    <li>
      <Link
        href={step.href}
        className={`group flex items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${wrapperClass}`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="font-mono text-[10px] text-muted-foreground/60 shrink-0">{String(index).padStart(2, '0')}</span>
        <span className={`min-w-0 flex-1 truncate text-sm leading-tight ${titleClass}`}>{step.title}</span>
        {isNext && (
          <Badge
            variant="outline"
            className="text-[9px] font-bold uppercase tracking-wider px-1 py-0 h-4 text-primary border-primary/40 shrink-0"
          >
            Next
          </Badge>
        )}
        {isDone && <span className="text-[9px] font-bold text-success shrink-0">DONE</span>}
        {!isDone && !isNext && <Lock className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />}
      </Link>
    </li>
  )
}

/* ─────────── Continue CTA (linked state primary action) ─────────── */

function ContinueCta({ nextStep }: { nextStep: { title: string; href: string; category: string } }) {
  return (
    <div className="border-t border-border/50 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Up next</div>
        <div className="mt-0.5 text-sm font-bold text-foreground truncate">{nextStep.title}</div>
        <div className="text-[10px] font-mono text-muted-foreground/70">{nextStep.category}</div>
      </div>
      <Link
        href={nextStep.href}
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99] shrink-0"
      >
        <Play className="h-3.5 w-3.5 fill-current" />
        Continue path
      </Link>
    </div>
  )
}

function PreviewCta({ view }: { view: AuthView }) {
  if (view === 'signed-out') {
    return (
      <div className="border-t border-border/50 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-xs text-muted-foreground">Sign in with Discord to track this path live as your elo climbs.</div>
        <button
          type="button"
          onClick={signIn}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-[#5865F2] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#4752C4] active:scale-[0.99]"
        >
          Continue with Discord
        </button>
      </div>
    )
  }
  return (
    <div className="border-t border-border/50 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="text-xs text-muted-foreground">Link your Brawlhalla profile so the path follows your live elo.</div>
      <Link
        href="/account"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99]"
      >
        Link Brawlhalla profile
      </Link>
    </div>
  )
}
