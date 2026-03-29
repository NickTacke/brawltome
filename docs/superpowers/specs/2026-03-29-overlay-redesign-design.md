# Desktop Overlay Redesign

Redesign the desktop overlay to match the website's design language and clean up the underlying code.

## Card Design

Each opponent card has two sections separated by a thin divider line.

### Header Section

- **Legend avatar** (34x34, rounded 7px, 2px border) — shows the opponent's most-played legend, using the same assets as the website (`/images/legends/avatars/{legendKey}.png`). Falls back to a placeholder silhouette if unavailable.
- **Name** (13px, bold, bright foreground) + **region badge** (9px, monospace, pill-shaped, muted background).
- **Tier badge** (9px, bold, gradient background color-coded by tier) + **playtime** (10px, muted).
- **Link icon** (top-right, ↗, muted blue at 0.45 opacity) — opens `brawltome.com/player/{id}` on click.

### Stats Section

- **Rating display**: `{elo} / {peak}` inline on one row. Elo is 18px font-weight-900 monospace, slash is 12px muted with 5px margin on each side, peak is 12px font-weight-700 dimmer monospace.
- **Win rate**: muted "WR" label (9px uppercase) + progress bar (55px wide, 5px tall, rounded) + percentage (11px bold monospace). Color-coded: green (>=60%), muted gray (50-59%), red (<50%).

### Card Container

- Semi-transparent background: `hsla(224, 19.5%, 15.1%, 0.82)` with `backdrop-filter: blur(12px)`.
- Border: `1px solid hsla(221.5, 20.3%, 25.1%, 0.7)`.
- Border radius: 8px. Padding: 10px.
- Separator: 1px line at `hsla(221.5, 20.3%, 25.1%, 0.5)` with 8px vertical margin.
- Card width: 300px. Gap between cards: 6px.

### Match Type Header

Replace the "Opponents" label with the match type (e.g., "Ranked 1v1") — 10px uppercase, tracked, muted foreground. Sits above the card list.

## Tier Badge Colors

Each tier gets a distinct gradient background:

| Tier | Gradient |
|------|----------|
| Diamond | purple `hsla(270, 50%, 38%)` → `hsla(280, 40%, 28%)`, text `hsl(270, 80%, 85%)` |
| Platinum | teal `hsla(175, 50%, 35%)` → `hsla(185, 40%, 25%)`, text `hsl(175, 80%, 85%)` |
| Gold | amber `hsla(43, 70%, 40%)` → `hsla(35, 60%, 30%)`, text `hsl(43, 90%, 85%)` |
| Silver | slate `hsla(220, 15%, 50%)` → `hsla(220, 15%, 38%)`, text `hsl(220, 20%, 85%)` |
| Bronze | brown `hsla(25, 50%, 38%)` → `hsla(20, 40%, 28%)`, text `hsl(25, 70%, 85%)` |
| Tin | gray `hsla(220, 10%, 35%)` → `hsla(220, 10%, 25%)`, text `hsl(220, 10%, 75%)` |
| Valhallan | gold-red `hsla(40, 80%, 50%)` → `hsla(15, 70%, 40%)`, text `hsl(40, 90%, 90%)` |
| Unranked | neutral `hsla(220, 10%, 30%)` → `hsla(220, 10%, 22%)`, text `hsl(220, 10%, 65%)` |

## Color System

Replicate the website's dark-mode HSL tokens in the overlay's own Tailwind/CSS config. No dependency on `@brawltome/ui`.

Key tokens (dark mode only — overlay is always dark):

- Background: `hsl(224, 19.5%, 15.1%)`
- Card foreground: `hsl(207.3, 21.6%, 90%)`
- Foreground: `hsl(210, 19.6%, 80%)`
- Muted foreground: `hsl(213.3, 15.1%, 64.9%)`
- Border: `hsl(221.5, 20.3%, 25.1%)`
- Muted bg: `hsl(222, 19.6%, 20%)`
- Primary: `hsl(212, 90.2%, 60%)`
- Success: `hsl(142, 70%, 45%)`
- Danger: `hsl(0, 60%, 60%)`

## Data Requirements

The opponent data model needs these additional fields beyond what currently exists:

- `legendKey` (string) — name key of most-played legend for the avatar image (e.g., "mordex")
- `winRate` (number) — win rate percentage (0-100)
- `isRanked` (boolean) — already exists in the match event
- `wins` / `games` (number) — alternative to pre-computed winRate

The overlay will bundle the legend avatar images locally (copied from `apps/web/public/images/legends/avatars/`).

## Code Cleanup

Address alongside the visual redesign:

1. **Fix `useContentBounds` missing dependency array** — currently re-runs every render, causing constant IPC calls. Add `[]` dependency.
2. **Remove unused Rust dependencies** — `serde_json` (unused), `Win32_Graphics_Dwm` feature flag (unused). Keep `serde` (needed by Tauri command parameter deserialization).
3. **Remove unused Rust code** — `Opponent` struct, `GameEvent` enum, `mock_opponents()` function (mock data lives in frontend now).
4. **Remove `tokio` dep** if no longer needed after removing the mock event loop.
5. **Clean up tauri.conf.json** — remove `macOSPrivateApi` (no macOS-specific code).

## Window Behavior

- Starts visible (`visible: true`), click-through enabled.
- Tray "Show/Hide" toggles visibility + click-through.
- `WS_EX_NOACTIVATE` prevents focus stealing.
- Cursor position polling (16ms) enables interaction only when cursor is over card bounds.
- `pointer-events: none` on root, `pointer-events: auto` on card panel.
- Panel `onMouseLeave` re-enables click-through.
- `shadow: false`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`.
