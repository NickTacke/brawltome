# Game Detection — In-Process Rust Design

**Date:** 2026-03-29
**PR:** #91 (desktop overlay)
**Status:** Approved

## Overview

Implement game detection directly in the Tauri/Rust backend. Rust reads Brawlhalla.exe process memory via Windows APIs, detects game state transitions, extracts opponent BHIDs, fetches opponent stats from the brawltome API, and emits `match_found`/`match_ended` Tauri events to the frontend.

No C++ sidecar. No IPC. Single process.

## Module Structure

```text
apps/desktop/core/src/
├── main.rs              ← existing, add game_detection spawn
├── game_detection.rs    ← state machine, orchestrates scanning + API + events
├── memory.rs            ← Windows API wrappers (ReadProcessMemory, VirtualQueryEx, etc.)
├── scanner.rs           ← scan logic (findBhID, find04c, getPlayers)
└── api_client.rs        ← HTTP client for brawltome API
```

## Architecture

```text
main.rs
  └── spawns game_detection::run() as async task
        ├── memory polling loop (100ms interval)
        │     ├── attach to Brawlhalla.exe (findProcessId → OpenProcess)
        │     ├── find my BhID via byte pattern scan
        │     ├── find 04c address → poll game state
        │     └── on match start: scan heap for player atoms → extract opponents
        ├── api_client::fetch_opponent(bhid) per opponent
        │     └── GET /api/overlay/opponent/:bhid → OpponentData
        └── emit Tauri events to frontend
              ├── "game-event" { event: "match_found", opponents, isRanked, localPlayerId }
              └── "game-event" { event: "match_ended" }
```

## Components

### 1. `memory.rs` — Windows API Wrappers

Thin safe wrappers around `windows-sys` FFI calls:

- `find_process_id(name: &str) -> Option<u32>` — uses `CreateToolhelp32Snapshot` + `Process32FirstW`/`Process32NextW`
- `open_process(pid: u32) -> Option<HANDLE>` — `OpenProcess` with `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`
- `read_memory(handle, addr, buf)` — `ReadProcessMemory`
- `heap_regions(handle) -> Vec<MemoryRegion>` — `VirtualQueryEx` loop, same filters as C++ draft (MEM_COMMIT, MEM_PRIVATE/MEM_MAPPED, no PAGE_GUARD, not PAGE_NOACCESS)
- `scan_regions(handle, regions, pattern)` — read each region into a Vec, `memcmp` for pattern matches

### 2. `scanner.rs` — Memory Scanning Logic

Direct port of the C++ scanner logic:

- `find_my_bhid(mem, regions) -> Option<u32>` — scan for `\x00hID\x00` pattern, read u32 at `addr - 24`
- `find_04c_addr(mem, regions, my_bhid) -> Option<usize>` — scan for bhid bytes, validate state at `+ BHID_04C_OFFSET (252)`
- `get_players(mem, regions, my_bhid, stale) -> PlayerMap` — atom-based IntMap table scan, extract name/SNID/slot, team detection for 2v2

**Offsets (same as C++ draft, verify against current Brawlhalla build):**
- Tamarin string: `+16` (length), `+24` (data, UTF-16LE)
- Player atom: `(bhid << 3) | 6`
- IntMap table: `addr - 256 * 16`, 512 entries × 16 bytes
- Player object offsets: `+44` (idCheck), `+60` (slot), `+64` (snid ptr), `+80` (name nested ptr)

**Valid game states:** 4, 8, 16, 32, 64, 1024, 2, 2048, 8192, 1048576, 8388608, 16777216

### 3. `api_client.rs` — HTTP Client

Calls the brawltome API for opponent data.

**Endpoint:** New public `GET /api/overlay/opponent/:bhid`

**Request:** No auth required (public endpoint)

**Response** (matches frontend `Opponent` type):
```json
{
  "brawlhallaId": 123,
  "name": "Player",
  "rating": 1827,
  "peakRating": 1900,
  "playtime": 917.3,
  "tier": "Platinum",
  "region": "EU",
  "legendKey": "ulgrim",
  "winRate": 58.1
}
```

- Uses `reqwest` with 10s timeout
- `fetch_opponent(bhid)` returns `Result<OpponentData, String>`
- API base URL configurable (default: `https://brawltome.app`)

### 4. `game_detection.rs` — State Machine

States: `Idle`, `Scanning`, `Tracking`, `Paused`

**State transitions (same as C++ draft):**
- `Idle → Scanning`: 04c changes to `CS_ONLINE_GAME` (4), `CS_LOCAL_GAME` (64), or `1048576`
- `Scanning → Tracking`: first successful player scan returns results
- `Scanning/Tracking → Paused`: 04c changes to `CS_PAUSED` (32)
- `Paused → Tracking`: 04c changes back to active game state
- `Scanning/Tracking → Idle`: 04c changes to `CS_MENU` (8) — emits `match_ended`
- Any state → reconnect: process read fails (game closed)

**Flow:**
1. `run(app_handle, api_url)` spawned as async task from `main.rs`
2. Outer loop: attach to process, inner loop: poll state
3. On attach: refresh heap regions once
4. Poll 04c every 100ms
5. On match start: trigger player scan (3s interval while scanning, 10s while tracking)
6. On new opponents found: fetch stats concurrently via `tokio::join`, emit `match_found`
7. On match end: emit `match_ended`, clear state

**Stale address filter:** Before each scan, snapshot all current atom addresses. Pass as exclusion set to next scan to avoid re-processing known addresses.

**Team detection:** In 2v2 (4 players), group by `(slot - 1) / 2` to identify teammates. Only fetch stats for non-teammate opponents.

**isRanked heuristic:** 1 non-teammate opponent = likely ranked 1v1. Can be refined later if the scanner exposes the game state value.

## Cargo.toml Additions

```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
serde_json = "1"
log = "0.4"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_UI_WindowsAndMessaging",   # existing
    "Win32_Foundation",               # existing
    "Win32_System_Diagnostics_ToolHelp",
    "Win32_System_Memory",
    "Win32_System_Diagnostics_Debug",
    "Win32_System_Threading",
] }
```

## New Public API Endpoint

Add to `apps/api/src/router/` — a new public tRPC procedure:

```text
trpc.overlay.opponent
  Input:  { bhid: number }
  Output: { brawlhallaId, name, rate, peakRating, playtime, tier, region, legendKey, winRate }
  Access: publicProcedure (no auth)
```

Implementation reuses existing `player.service.ts` — calls `getPlayer(ctx, bhid)`, extracts the overlay-relevant fields, returns the `Opponent` shape.

## Frontend Impact

None. The existing `useGameEvents` hook listens for `"game-event"` Tauri events with `match_found`/`match_ended` payloads. The Rust backend emits exactly those events. TypeScript types (`Opponent`, `MatchFoundEvent`, `MatchEndedEvent`) are already defined and match the planned payloads.

## What Changes from the C++ Draft

| Aspect | C++ Sidecar Draft | In-Process Rust |
|--------|-------------------|-----------------|
| Process | Separate bh-monitor.exe | Same process as Tauri |
| IPC | stdin/stdout JSON lines | Direct function calls |
| Memory access | Windows API via C++ | Windows API via `windows-sys` |
| API calls | N/A (C++ doesn't fetch) | `reqwest` in Rust |
| Sidecar config | `externalBin` in tauri.conf.json | Not needed |
| Shell plugin | Required for spawning | Not needed |
| Tauri version | Draft used v1 APIs | Using v2 |

## Verification Checklist

| Item | How to verify |
|------|--------------|
| Tamarin string offsets (+16 length, +24 data) | Check in Cheat Engine if names come out garbled |
| Player object offsets (+44, +60, +64, +80) | Compare against Python memutil.py if available |
| BHID_04C_OFFSET (252) | Same as Python/C++, should be correct |
| Region refresh | Currently once on attach; add periodic if regions shift |
| API endpoint returns correct shape | Test with curl against the new endpoint |
