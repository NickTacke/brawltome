# Overlay Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the desktop overlay cards to match the website's dark-mode design language, add legend avatars and win rate bars, and clean up dead code.

**Architecture:** The overlay is a Tauri v2 app with a React/Tailwind frontend. Changes are entirely within `apps/desktop/` — new CSS tokens in `styles.css`, updated TypeScript types, a new `TierBadge` component, a rewritten `OpponentCard`, and Rust backend cleanup. Legend avatar images are copied from `apps/web/public/` into a local `public/` directory served by Vite.

**Tech Stack:** Tauri 2, React 19, Tailwind CSS 4, TypeScript, Rust

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/desktop/ui/styles.css` | Add overlay color tokens as CSS custom properties |
| Modify | `apps/desktop/ui/types.ts` | Add `legendKey`, `winRate` fields to `Opponent`; add `MatchType` |
| Create | `apps/desktop/ui/components/TierBadge.tsx` | Tier-specific gradient badge component |
| Modify | `apps/desktop/ui/components/OpponentCard.tsx` | Full rewrite with new design |
| Modify | `apps/desktop/ui/components/OverlayPanel.tsx` | Match type header, updated gap/width |
| Modify | `apps/desktop/ui/hooks/useGameEvents.ts` | Update mock data with new fields, expose `matchType` |
| Modify | `apps/desktop/ui/hooks/useContentBounds.ts` | Fix missing dependency array |
| Modify | `apps/desktop/ui/App.tsx` | Pass `matchType` to `OverlayPanel` |
| Create | `apps/desktop/public/legends/` | Legend avatar images (copied from web app) |
| Modify | `apps/desktop/core/src/main.rs` | Remove dead code (structs, enums, mock fn) |
| Modify | `apps/desktop/core/Cargo.toml` | Remove `serde_json`, `Win32_Graphics_Dwm`; remove `macos-private-api` |
| Modify | `apps/desktop/core/tauri.conf.json` | Remove `macOSPrivateApi` |

---

### Task 1: Copy legend avatar assets

**Files:**
- Create: `apps/desktop/public/legends/` (directory with 68 PNG files)

- [ ] **Step 1: Copy legend avatars from web app to desktop public dir**

```bash
mkdir -p apps/desktop/public/legends
cp apps/web/public/images/legends/avatars/*.png apps/desktop/public/legends/
```

- [ ] **Step 2: Verify files copied**

Run: `ls apps/desktop/public/legends/ | wc -l`
Expected: `68`

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/public/legends/
git commit -m "chore(desktop): copy legend avatar assets from web app"
```

---

### Task 2: Add CSS color tokens

**Files:**
- Modify: `apps/desktop/ui/styles.css`

- [ ] **Step 1: Add overlay color tokens as CSS custom properties**

Replace the entire contents of `apps/desktop/ui/styles.css` with:

```css
@import "tailwindcss";

:root {
  --overlay-bg: 224 19.5% 15.1%;
  --overlay-card-fg: 207.3 21.6% 90%;
  --overlay-fg: 210 19.6% 80%;
  --overlay-muted-fg: 213.3 15.1% 64.9%;
  --overlay-border: 221.5 20.3% 25.1%;
  --overlay-muted-bg: 222 19.6% 20%;
  --overlay-primary: 212 90.2% 60%;
  --overlay-success: 142 70% 45%;
  --overlay-danger: 0 60% 60%;
}

html,
body,
#root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
}
```

- [ ] **Step 2: Verify the app still renders**

Run: `cd apps/desktop && bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/ui/styles.css
git commit -m "feat(desktop): add website dark-mode color tokens to overlay CSS"
```

---

### Task 3: Update types and mock data

**Files:**
- Modify: `apps/desktop/ui/types.ts`
- Modify: `apps/desktop/ui/hooks/useGameEvents.ts`
- Modify: `apps/desktop/ui/App.tsx`

- [ ] **Step 1: Add new fields to Opponent type and MatchType**

Replace the entire contents of `apps/desktop/ui/types.ts` with:

```typescript
export interface Opponent {
  brawlhallaId: number
  name: string
  rating: number
  peakRating: number
  playtime: number // hours
  tier: string
  region: string
  legendKey: string
  winRate: number // 0-100
}

export interface MatchFoundEvent {
  event: 'match_found'
  opponents: Opponent[]
  isRanked: boolean
  localPlayerId: number
}

export interface MatchEndedEvent {
  event: 'match_ended'
}

export type GameEvent = MatchFoundEvent | MatchEndedEvent
```

- [ ] **Step 2: Update mock data and expose matchType**

Replace the entire contents of `apps/desktop/ui/hooks/useGameEvents.ts` with:

```typescript
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

const MOCK_OPPONENTS: Opponent[] = [
  {
    brawlhallaId: 91913839,
    name: 'brawltome.app',
    rating: 1827,
    peakRating: 1827,
    playtime: 917.3,
    tier: 'Platinum',
    region: 'EU',
    legendKey: 'mordex',
    winRate: 62,
  },
  {
    brawlhallaId: 8301816,
    name: 'Straalman',
    rating: 0,
    peakRating: 0,
    playtime: 1532.6,
    tier: 'Unranked',
    region: 'EU',
    legendKey: 'bodvar',
    winRate: 38,
  },
]

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>(MOCK_OPPONENTS)
  const [matchType, setMatchType] = useState('Ranked 1v1')

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setMatchType(payload.isRanked ? 'Ranked 1v1' : 'Custom')
      } else if (payload.event === 'match_ended') {
        setOpponents([])
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  return { opponents, matchType }
}
```

- [ ] **Step 3: Pass matchType through App**

Replace the entire contents of `apps/desktop/ui/App.tsx` with:

```tsx
import { OverlayPanel } from './components/OverlayPanel'
import { useGameEvents } from './hooks/useGameEvents'

export default function App() {
  const { opponents, matchType } = useGameEvents()

  return (
    <div className="flex h-screen items-start justify-end p-4 pt-20">
      <OverlayPanel opponents={opponents} matchType={matchType} />
    </div>
  )
}
```

- [ ] **Step 4: Verify types compile**

Run: `cd apps/desktop && bun run typecheck`
Expected: Errors in `OverlayPanel.tsx` about the new `matchType` prop (expected — fixed in Task 5).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/ui/types.ts apps/desktop/ui/hooks/useGameEvents.ts apps/desktop/ui/App.tsx
git commit -m "feat(desktop): add legendKey, winRate fields and matchType state"
```

---

### Task 4: Create TierBadge component

**Files:**
- Create: `apps/desktop/ui/components/TierBadge.tsx`

- [ ] **Step 1: Create the TierBadge component**

Create `apps/desktop/ui/components/TierBadge.tsx` with:

```tsx
const TIER_STYLES: Record<string, { gradient: string; text: string }> = {
  Diamond: {
    gradient: 'from-[hsla(270,50%,38%,0.9)] to-[hsla(280,40%,28%,0.9)]',
    text: 'text-[hsl(270,80%,85%)]',
  },
  Platinum: {
    gradient: 'from-[hsla(175,50%,35%,0.9)] to-[hsla(185,40%,25%,0.9)]',
    text: 'text-[hsl(175,80%,85%)]',
  },
  Gold: {
    gradient: 'from-[hsla(43,70%,40%,0.9)] to-[hsla(35,60%,30%,0.9)]',
    text: 'text-[hsl(43,90%,85%)]',
  },
  Silver: {
    gradient: 'from-[hsla(220,15%,50%,0.9)] to-[hsla(220,15%,38%,0.9)]',
    text: 'text-[hsl(220,20%,85%)]',
  },
  Bronze: {
    gradient: 'from-[hsla(25,50%,38%,0.9)] to-[hsla(20,40%,28%,0.9)]',
    text: 'text-[hsl(25,70%,85%)]',
  },
  Tin: {
    gradient: 'from-[hsla(220,10%,35%,0.9)] to-[hsla(220,10%,25%,0.9)]',
    text: 'text-[hsl(220,10%,75%)]',
  },
  Valhallan: {
    gradient: 'from-[hsla(40,80%,50%,0.9)] to-[hsla(15,70%,40%,0.9)]',
    text: 'text-[hsl(40,90%,90%)]',
  },
  Unranked: {
    gradient: 'from-[hsla(220,10%,30%,0.9)] to-[hsla(220,10%,22%,0.9)]',
    text: 'text-[hsl(220,10%,65%)]',
  },
}

function getStyle(tier: string) {
  // Tier strings may include rank number e.g. "Diamond 1", so match on prefix
  const base = Object.keys(TIER_STYLES).find((key) => tier.startsWith(key))
  return TIER_STYLES[base ?? 'Unranked']
}

interface TierBadgeProps {
  tier: string
}

export function TierBadge({ tier }: TierBadgeProps) {
  const style = getStyle(tier)

  return (
    <span
      className={`bg-gradient-to-br ${style.gradient} ${style.text} rounded px-1.5 py-px text-[9px] font-semibold`}
    >
      {tier}
    </span>
  )
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd apps/desktop && bun run typecheck`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/ui/components/TierBadge.tsx
git commit -m "feat(desktop): add TierBadge component with per-tier gradient colors"
```

---

### Task 5: Rewrite OpponentCard and OverlayPanel

**Files:**
- Modify: `apps/desktop/ui/components/OpponentCard.tsx`
- Modify: `apps/desktop/ui/components/OverlayPanel.tsx`

- [ ] **Step 1: Rewrite OpponentCard with new design**

Replace the entire contents of `apps/desktop/ui/components/OpponentCard.tsx` with:

```tsx
import { open } from '@tauri-apps/plugin-shell'
import type { Opponent } from '../types'
import { TierBadge } from './TierBadge'

interface OpponentCardProps {
  opponent: Opponent
}

function formatPlaytime(hours: number): string {
  return hours >= 1000 ? `${(hours / 1000).toFixed(1)}k hrs` : `${Math.round(hours)} hrs`
}

function winRateColor(rate: number): string {
  if (rate >= 60) return 'hsl(var(--overlay-success))'
  if (rate >= 50) return 'hsl(var(--overlay-muted-fg))'
  return 'hsl(var(--overlay-danger))'
}

export function OpponentCard({ opponent }: OpponentCardProps) {
  const color = winRateColor(opponent.winRate)

  return (
    <div className="w-[300px] rounded-lg border border-[hsla(var(--overlay-border)/0.7)] bg-[hsla(var(--overlay-bg)/0.82)] p-2.5 backdrop-blur-[12px]">
      {/* Header: avatar + name/tier + link */}
      <div className="flex items-center gap-2">
        <div className="size-[34px] shrink-0 overflow-hidden rounded-[7px] border-2 border-[hsl(var(--overlay-border))] bg-[hsl(var(--overlay-muted-bg))]">
          <img
            src={`/legends/${opponent.legendKey}.png`}
            alt={opponent.legendKey}
            className="size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-bold text-[hsl(var(--overlay-card-fg))]">
              {opponent.name}
            </span>
            <span className="rounded-full bg-[hsla(var(--overlay-muted-bg)/0.8)] px-1.5 py-px font-mono text-[9px] text-[hsl(var(--overlay-muted-fg))]">
              {opponent.region}
            </span>
          </div>
          <div className="mt-px flex items-center gap-1.5">
            <TierBadge tier={opponent.tier} />
            <span className="text-[10px] text-[hsl(var(--overlay-muted-fg))]">
              {formatPlaytime(opponent.playtime)}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="shrink-0 text-[13px] text-[hsl(var(--overlay-primary))] opacity-45 transition-opacity hover:opacity-90"
          onClick={() => open(`https://brawltome.com/player/${opponent.brawlhallaId}`)}
        >
          ↗
        </button>
      </div>

      {/* Separator */}
      <div className="my-2 h-px bg-[hsla(var(--overlay-border)/0.5)]" />

      {/* Stats: elo / peak + WR bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline">
          <span className="font-mono text-[18px] font-black tracking-tight text-[hsl(var(--overlay-card-fg))]">
            {opponent.rating}
          </span>
          <span className="mx-[5px] text-[12px] text-[hsl(213.3,15.1%,40%)]">/</span>
          <span className="font-mono text-[12px] font-bold text-[hsl(213.3,15.1%,50%)]">
            {opponent.peakRating}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wide text-[hsl(213.3,15.1%,45%)]">
            WR
          </span>
          <div className="h-[5px] w-[55px] overflow-hidden rounded-full bg-[hsla(var(--overlay-muted-bg)/0.8)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${opponent.winRate}%`, backgroundColor: color }}
            />
          </div>
          <span className="font-mono text-[11px] font-semibold" style={{ color }}>
            {opponent.winRate}%
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update OverlayPanel with matchType header and new layout**

Replace the entire contents of `apps/desktop/ui/components/OverlayPanel.tsx` with:

```tsx
import { useCursorForwarding } from '../hooks/useCursorForwarding'
import { useContentBounds } from '../hooks/useContentBounds'
import type { Opponent } from '../types'
import { OpponentCard } from './OpponentCard'

interface OverlayPanelProps {
  opponents: Opponent[]
  matchType: string
}

export function OverlayPanel({ opponents, matchType }: OverlayPanelProps) {
  const panelRef = useContentBounds<HTMLDivElement>()
  const { onMouseLeave } = useCursorForwarding()

  if (opponents.length === 0) return null

  return (
    <div ref={panelRef} className="pointer-events-auto flex flex-col gap-1.5" onMouseLeave={onMouseLeave}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--overlay-muted-fg))]">
        {matchType}
      </p>
      {opponents.map((opponent) => (
        <OpponentCard key={opponent.brawlhallaId} opponent={opponent} />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/desktop && bun run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/ui/components/OpponentCard.tsx apps/desktop/ui/components/OverlayPanel.tsx
git commit -m "feat(desktop): redesign opponent cards with new visual style"
```

---

### Task 6: Fix useContentBounds dependency array

**Files:**
- Modify: `apps/desktop/ui/hooks/useContentBounds.ts`

- [ ] **Step 1: Add missing dependency array to useEffect**

In `apps/desktop/ui/hooks/useContentBounds.ts`, change line 27 from:

```typescript
  })
```

to:

```typescript
  }, [])
```

This is the closing of the `useEffect` call. The current code has no dependency array, causing the effect to re-run on every render. Adding `[]` makes it run only on mount.

- [ ] **Step 2: Verify types compile**

Run: `cd apps/desktop && bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/ui/hooks/useContentBounds.ts
git commit -m "fix(desktop): add missing dependency array to useContentBounds"
```

---

### Task 7: Clean up Rust backend and config

**Files:**
- Modify: `apps/desktop/core/src/main.rs`
- Modify: `apps/desktop/core/Cargo.toml`
- Modify: `apps/desktop/core/tauri.conf.json`

- [ ] **Step 1: Remove dead Rust code from main.rs**

The current `main.rs` has no dead Opponent/GameEvent/mock code (it was already removed in prior work). Verify by checking:

Run: `grep -n "struct Opponent\|enum GameEvent\|fn mock_opponents\|use serde" apps/desktop/core/src/main.rs`
Expected: No matches. If any are found, remove them.

- [ ] **Step 2: Clean up Cargo.toml**

Replace the entire contents of `apps/desktop/core/Cargo.toml` with:

```toml
[package]
name = "brawltome-desktop"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["time"] }

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_UI_WindowsAndMessaging", "Win32_Foundation"] }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

Changes: removed `serde_json`, removed `macos-private-api` feature from tauri, removed `Win32_Graphics_Dwm` feature from windows-sys.

- [ ] **Step 3: Clean up tauri.conf.json**

In `apps/desktop/core/tauri.conf.json`, remove the `macOSPrivateApi` line. Replace:

```json
  "app": {
    "macOSPrivateApi": true,
    "windows": [
```

with:

```json
  "app": {
    "windows": [
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd apps/desktop && cargo check --manifest-path core/Cargo.toml`
Expected: Compiles with no errors (warnings about unused imports are OK at this stage).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/core/Cargo.toml apps/desktop/core/tauri.conf.json apps/desktop/core/src/main.rs
git commit -m "chore(desktop): remove unused deps and config flags"
```

---

### Task 8: Verify full build and visual check

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd apps/desktop && bun run typecheck`
Expected: No errors.

- [ ] **Step 2: Run dev server**

Run: `cd apps/desktop && bun run dev`
Expected: Tauri window opens. Overlay shows two mock opponent cards with:
- Legend avatars (mordex, bodvar) from local `/legends/` assets
- Tier badges with correct gradient colors (Platinum = teal, Unranked = gray)
- Rating display as `1827 / 1827` format
- Win rate bars (62% green, 38% red)
- "Ranked 1v1" header above cards
- Semi-transparent cards with backdrop blur
- Link icon (↗) on each card

- [ ] **Step 3: Verify click-through behavior**

- Areas outside cards should be fully click-through
- Hovering over a card should enable interaction
- Moving mouse off the card panel should re-enable click-through
- Clicking ↗ should open brawltome.com in the browser

- [ ] **Step 4: Commit any final adjustments if needed**
