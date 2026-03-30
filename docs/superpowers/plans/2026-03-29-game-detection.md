# Game Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement in-process game detection that reads Brawlhalla.exe memory, detects matches, fetches opponent stats from the brawltome API, and emits events to the overlay frontend.

**Architecture:** Rust reads Brawlhalla process memory via `windows-sys` FFI, runs a state machine to detect match start/end, fetches opponent data from a new public API endpoint, and emits Tauri events the frontend already listens for.

**Tech Stack:** Rust (windows-sys, reqwest, tokio, serde), TypeScript (tRPC/Hono), existing Tauri v2 app

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/desktop/core/Cargo.toml` | Add reqwest, serde_json, log; extend windows-sys features |
| Create | `apps/desktop/core/src/memory.rs` | Safe wrappers over Windows memory/process APIs |
| Create | `apps/desktop/core/src/scanner.rs` | Byte pattern scanning, player extraction from Brawlhalla heap |
| Create | `apps/desktop/core/src/api_client.rs` | HTTP client for brawltome overlay API |
| Create | `apps/desktop/core/src/game_detection.rs` | State machine: attach → scan → fetch → emit |
| Modify | `apps/desktop/core/src/main.rs` | Add module declarations, spawn game detection task |
| Modify | `apps/api/src/serve.ts` | Add REST endpoint for overlay opponent data |
| Modify | `apps/desktop/ui/hooks/useGameEvents.ts` | Remove mock data |

---

### Task 1: Update Cargo.toml

**Files:**
- Modify: `apps/desktop/core/Cargo.toml`

- [ ] **Step 1: Add new dependencies and windows-sys features**

Replace the full file with:

```toml
[package]
name = "brawltome-desktop"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json"] }
log = "0.4"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = [
    "Win32_UI_WindowsAndMessaging",
    "Win32_Foundation",
    "Win32_System_Diagnostics_ToolHelp",
    "Win32_System_Memory",
    "Win32_System_Diagnostics_Debug",
    "Win32_System_Threading",
] }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/Cargo.toml
git commit -m "chore(desktop): add game detection dependencies to Cargo.toml"
```

---

### Task 2: Create memory.rs — Windows API Wrappers

**Files:**
- Create: `apps/desktop/core/src/memory.rs`

- [ ] **Step 1: Create the memory module**

```rust
use std::ffi::OsStr;
use std::mem;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{
    VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_MAPPED, MEM_PRIVATE,
    PAGE_GUARD, PAGE_NOACCESS,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};

pub struct MemoryRegion {
    pub base: usize,
    pub size: usize,
}

/// Find a process ID by executable name (e.g., "Brawlhalla.exe").
pub fn find_process_id(name: &str) -> Option<u32> {
    let wide_name: Vec<u16> = OsStr::new(name).encode_wide().chain(std::iter::once(0)).collect();
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snap == INVALID_HANDLE {
        return None;
    }
    let mut pe = PROCESSENTRY32W {
        dwSize: mem::size_of::<PROCESSENTRY32W>() as u32,
        ..unsafe { mem::zeroed() }
    };
    let mut pid = None;
    if unsafe { Process32FirstW(snap, &mut pe) } != 0 {
        loop {
            let exe_name = unsafe { &pe.szExeFile };
            let exe_str: String = exe_name
                .iter()
                .take_while(|&&c| c != 0)
                .map(|&c| c as u8 as char)
                .collect();
            if exe_str.eq_ignore_ascii_case(name) {
                pid = Some(pe.th32ProcessID);
                break;
            }
            if unsafe { Process32NextW(snap, &mut pe) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snap) };
    pid
}

/// Open a process for memory reading.
pub fn open_process(pid: u32) -> Option<HANDLE> {
    let handle = unsafe {
        OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, 0, pid)
    };
    if handle == 0 { None } else { Some(handle) }
}

/// Read memory from a process at the given address.
pub fn read_memory(handle: HANDLE, addr: usize, buf: &mut [u8]) -> bool {
    let mut bytes_read = 0usize;
    let ok = unsafe {
        ReadProcessMemory(
            handle,
            addr as *const _,
            buf.as_mut_ptr() as *mut _,
            buf.len(),
            &mut bytes_read,
        )
    };
    ok != 0 && bytes_read == buf.len()
}

/// Read a typed value from process memory.
pub fn read<T: Default + Copy>(handle: HANDLE, addr: usize) -> Option<T> {
    let mut val = T::default();
    if read_memory(handle, addr, unsafe {
        std::slice::from_raw_parts_mut(&mut val as *mut T as *mut u8, std::mem::size_of::<T>())
    }) {
        Some(val)
    } else {
        None
    }
}

/// Collect committed heap regions from the target process.
pub fn heap_regions(handle: HANDLE) -> Vec<MemoryRegion> {
    let mut regions = Vec::new();
    let mut addr = 0usize;
    let mut mbi: MEMORY_BASIC_INFORMATION = unsafe { mem::zeroed() };

    loop {
        let result = unsafe {
            VirtualQueryEx(
                handle,
                addr as *const _,
                &mut mbi,
                mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if result == 0 {
            break;
        }

        if mbi.State == MEM_COMMIT
            && (mbi.Type == MEM_PRIVATE || mbi.Type == MEM_MAPPED)
            && (mbi.Protect & PAGE_GUARD) == 0
            && mbi.Protect != PAGE_NOACCESS
        {
            regions.push(MemoryRegion {
                base: mbi.BaseAddress as usize,
                size: mbi.RegionSize,
            });
        }

        let next = mbi.BaseAddress as usize + mbi.RegionSize;
        if next <= addr {
            break; // overflow guard
        }
        addr = next;
    }
    regions
}

/// Scan regions for a byte pattern, returning matching addresses.
pub fn scan_regions(
    handle: HANDLE,
    regions: &[MemoryRegion],
    pattern: &[u8],
) -> Vec<usize> {
    let mut results = Vec::new();
    for r in regions {
        let mut chunk = vec![0u8; r.size];
        let mut bytes_read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(
                handle,
                r.base as *const _,
                chunk.as_mut_ptr() as *mut _,
                r.size,
                &mut bytes_read,
            )
        };
        if ok == 0 {
            continue;
        }
        for i in 0..=(bytes_read.saturating_sub(pattern.len())) {
            if chunk[i..].starts_with(pattern) {
                results.push(r.base + i);
            }
        }
    }
    results
}

/// Read a Tamarin/Haxe string from process memory.
///
/// Layout: `{ vtable(8), hash(4), pad(4), length(4), pad(4), data... }`
/// Data is UTF-16LE. Offsets +16 (length) and +24 (data).
pub fn read_tamarin_string(handle: HANDLE, ptr: usize) -> Option<String> {
    if ptr == 0 {
        return None;
    }
    let length: u32 = read(handle, ptr + 16)?;
    if length == 0 || length > 4096 {
        return None;
    }
    let mut buf = vec![0u16; length as usize];
    if !read_memory(handle, ptr + 24, unsafe {
        std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut u8, length as usize * 2)
    }) {
        return None;
    }
    Some(
        buf.iter()
            .map(|&ch| if ch < 128 { ch as u8 as char } else { '?' })
            .collect(),
    )
}

const INVALID_HANDLE: HANDLE = -1isize as HANDLE;

/// Close a process handle.
pub fn close_handle(handle: HANDLE) {
    if handle != 0 && handle != INVALID_HANDLE {
        unsafe { CloseHandle(handle) };
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/src/memory.rs
git commit -m "feat(desktop): add Windows memory reading wrappers"
```

---

### Task 3: Create scanner.rs — Memory Scanning Logic

**Files:**
- Create: `apps/desktop/core/src/scanner.rs`

- [ ] **Step 1: Create the scanner module**

```rust
use std::collections::HashMap;
use std::collections::HashSet;

use crate::memory;

// ── Constants ──────────────────────────────────────────────────────────────────

/// Offset from a found BhID address to the connection-state value.
const BHID_04C_OFFSET: usize = 252;

// Connection state values
const CS_ONLINE_GAME: u32 = 4;
const CS_MENU: u32 = 8;
const CS_CHAR_SELECT: u32 = 16;
const CS_PAUSED: u32 = 32;
const CS_LOCAL_GAME: u32 = 64;
const CS_REPLAY: u32 = 1024;

const VALID_STATES: [u32; 12] = [
    CS_ONLINE_GAME, CS_MENU, CS_CHAR_SELECT, CS_PAUSED,
    CS_LOCAL_GAME, CS_REPLAY,
    2, 2048, 8192, 1048576, 8388608, 16777216,
];

pub const MENU_STATES: [u32; 1] = [CS_MENU];
pub const ACTIVE_GAME_STATES: [u32; 3] = [CS_ONLINE_GAME, CS_LOCAL_GAME, 1048576];
pub const PAUSE_STATES: [u32; 1] = [CS_PAUSED];
pub const CHAR_SELECT_STATES: [u32; 1] = [CS_CHAR_SELECT];
pub const IGNORE_STATES: [u32; 3] = [CS_REPLAY, 2048, 8192];

// ── Data types ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct PlayerInfo {
    pub bhid: u32,
    pub name: String,
    #[allow(dead_code)]
    pub snid: String,
    pub slot: u32,
    pub is_teammate: bool,
}

pub type PlayerMap = HashMap<u32, PlayerInfo>;

// ── Scanner functions ──────────────────────────────────────────────────────────

/// Find the local player's BhID by scanning for the `\x00hID\x00` pattern.
pub fn find_my_bhid(
    handle: windows_sys::Win32::Foundation::HANDLE,
    regions: &[memory::MemoryRegion],
) -> Option<u32> {
    let pattern: &[u8] = &[0x00, b'h', b'I', b'D', 0x00];
    let addrs = memory::scan_regions(handle, regions, pattern);

    for addr in addrs {
        if addr >= 24 {
            if let Some(v) = memory::read::<u32>(handle, addr - 24) {
                if v > 0 {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Find the 04c address for a given BhID — the connection state indicator.
pub fn find_04c_addr(
    handle: windows_sys::Win32::Foundation::HANDLE,
    my_bhid: u32,
    regions: &[memory::MemoryRegion],
) -> Option<usize> {
    let bhid_bytes = my_bhid.to_le_bytes();
    let addrs = memory::scan_regions(handle, regions, &bhid_bytes);

    for ba in addrs {
        let candidate = ba + BHID_04C_OFFSET;
        if let Some(val) = memory::read::<u32>(handle, candidate) {
            if VALID_STATES.contains(&val) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Read the current connection state value at the 04c address.
pub fn read_04c(
    handle: windows_sys::Win32::Foundation::HANDLE,
    addr_04c: usize,
) -> Option<u32> {
    memory::read::<u32>(handle, addr_04c)
}

/// Check if a state value represents an active game.
pub fn is_active_game(state: u32) -> bool {
    ACTIVE_GAME_STATES.contains(&state)
}

/// Check if a state value represents the menu.
pub fn is_menu(state: u32) -> bool {
    MENU_STATES.contains(&state)
}

/// Check if a state value represents paused.
pub fn is_paused(state: u32) -> bool {
    PAUSE_STATES.contains(&state)
}

/// Check if a state value should be ignored.
pub fn is_ignored(state: u32) -> bool {
    IGNORE_STATES.contains(&state)
}

/// Check if a state value represents character select.
pub fn is_char_select(state: u32) -> bool {
    CHAR_SELECT_STATES.contains(&state)
}

/// Extract all players from the process heap by scanning for IntMap atoms.
pub fn get_players(
    handle: windows_sys::Win32::Foundation::HANDLE,
    my_bhid: u32,
    regions: &[memory::MemoryRegion],
    stale_addrs: &HashSet<usize>,
) -> PlayerMap {
    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let addrs = memory::scan_regions(handle, regions, &atom_bytes);

    let mut players = PlayerMap::new();

    for addr in addrs {
        if stale_addrs.contains(&addr) {
            continue;
        }

        // Read the 512-entry IntMap table centered around the found atom.
        let table_base = match addr.checked_sub(256 * 16) {
            Some(b) => b,
            None => continue,
        };
        let mut td = vec![0u8; 512 * 16];
        if !memory::read_memory(handle, table_base, &mut td) {
            continue;
        }

        for i in 0..512 {
            let off = i * 16;

            let atom = u32::from_le_bytes([td[off], td[off + 1], td[off + 2], td[off + 3]]);
            let pad = u32::from_le_bytes([td[off + 4], td[off + 5], td[off + 6], td[off + 7]]);

            if (atom & 7) != 6 || pad != 0 || atom <= 6 {
                continue;
            }
            let bhid = atom >> 3;
            if bhid == 0 || players.contains_key(&bhid) {
                continue;
            }

            let raw_ptr = u64::from_le_bytes([
                td[off + 8], td[off + 9], td[off + 10], td[off + 11],
                td[off + 12], td[off + 13], td[off + 14], td[off + 15],
            ]);
            let ptr = (raw_ptr & !7) as usize;
            if ptr == 0 {
                continue;
            }

            // Read 88-byte player object
            let mut obj = [0u8; 88];
            if !memory::read_memory(handle, ptr, &mut obj) {
                continue;
            }

            let id_check = u32::from_le_bytes([obj[44], obj[45], obj[46], obj[47]]);
            let slot = u32::from_le_bytes([obj[60], obj[61], obj[62], obj[63]]);

            if id_check != bhid || slot == 0 {
                continue;
            }

            // SNID
            let snid = if let Some(snid_raw) = memory::read::<u64>(handle, ptr + 64) {
                let snid_ptr = (snid_raw & !7) as usize;
                memory::read_tamarin_string(handle, snid_ptr).unwrap_or_default()
            } else {
                String::new()
            };

            // Name (nested pointer: +80 → +56 → string)
            let name = if let Some(nested_raw) = memory::read::<u64>(handle, ptr + 80) {
                let nested_ptr = (nested_raw & !7) as usize;
                if nested_ptr != 0 {
                    if let Some(name_str_raw) = memory::read::<u64>(handle, nested_ptr + 56) {
                        let name_ptr = (name_str_raw & !7) as usize;
                        memory::read_tamarin_string(handle, name_ptr).unwrap_or_default()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            players.insert(
                bhid,
                PlayerInfo {
                    bhid,
                    name,
                    snid,
                    slot,
                    is_teammate: false,
                },
            );
        }
    }

    // Team detection: 2v2 has 4 players
    if let Some(my_player) = players.get(&my_bhid) {
        if players.len() == 4 {
            let my_pair = (my_player.slot - 1) / 2;
            for p in players.values_mut() {
                p.is_teammate = ((p.slot - 1) / 2) == my_pair;
            }
        }
    }

    players
}

/// Snapshot all current atom addresses for stale filtering.
pub fn snapshot_stale(
    handle: windows_sys::Win32::Foundation::HANDLE,
    my_bhid: u32,
    regions: &[memory::MemoryRegion],
) -> HashSet<usize> {
    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let addrs = memory::scan_regions(handle, regions, &atom_bytes);
    addrs.into_iter().collect()
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/src/scanner.rs
git commit -m "feat(desktop): add Brawlhalla memory scanner"
```

---

### Task 4: Create api_client.rs — HTTP Client

**Files:**
- Create: `apps/desktop/core/src/api_client.rs`

- [ ] **Step 1: Create the API client module**

```rust
use serde::Deserialize;
use std::time::Duration;

const DEFAULT_API_BASE: &str = "https://brawltome.app";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Clone)]
pub struct OpponentData {
    #[serde(rename = "brawlhallaId")]
    pub brawlhalla_id: u32,
    pub name: String,
    pub rating: u32,
    #[serde(rename = "peakRating")]
    pub peak_rating: u32,
    pub playtime: f64,
    pub tier: String,
    pub region: String,
    #[serde(rename = "legendKey")]
    pub legend_key: String,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
}

pub struct ApiClient {
    client: reqwest::Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let base_url = if base_url.is_empty() {
            DEFAULT_API_BASE.to_string()
        } else {
            base_url
        };
        Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("Failed to build HTTP client"),
            base_url,
        }
    }

    pub async fn fetch_opponent(&self, bhid: u32) -> Result<OpponentData, String> {
        let url = format!("{}/api/overlay/opponent/{}", self.base_url, bhid);
        self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?
            .json::<OpponentData>()
            .await
            .map_err(|e| format!("parse failed: {e}"))
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/src/api_client.rs
git commit -m "feat(desktop): add brawltome API client for opponent data"
```

---

### Task 5: Create game_detection.rs — State Machine

**Files:**
- Create: `apps/desktop/core/src/game_detection.rs`

- [ ] **Step 1: Create the game detection module**

```rust
use std::collections::HashSet;
use std::sync::Arc;

use serde::Serialize;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use windows_sys::Win32::Foundation::HANDLE;

use crate::api_client::{ApiClient, OpponentData};
use crate::memory;
use crate::scanner;

// ── Frontend event payloads ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
struct MatchFoundPayload {
    event: &'static str,
    opponents: Vec<OpponentData>,
    #[serde(rename = "isRanked")]
    is_ranked: bool,
    #[serde(rename = "localPlayerId")]
    local_player_id: u32,
}

#[derive(Debug, Serialize, Clone)]
struct MatchEndedPayload {
    event: &'static str,
}

// ── Detection state ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum ScannerState {
    Idle,
    Scanning,
    Tracking,
    Paused,
}

struct DetectionState {
    match_active: bool,
    local_player_id: u32,
}

impl Default for DetectionState {
    fn default() -> Self {
        Self {
            match_active: false,
            local_player_id: 0,
        }
    }
}

// ── Timing ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const SCAN_INTERVAL_SCANNING: Duration = Duration::from_secs(3);
const SCAN_INTERVAL_TRACKING: Duration = Duration::from_secs(10);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);

// ── Entry point ────────────────────────────────────────────────────────────────

pub async fn run(app: tauri::AppHandle, api_url: String) {
    let api = Arc::new(ApiClient::new(api_url));

    loop {
        match run_cycle(&app, Arc::clone(&api)).await {
            Ok(()) => log::warn!("Detection cycle ended, restarting..."),
            Err(e) => log::error!("Detection error: {e}, restarting in 3s..."),
        }
        sleep(RECONNECT_DELAY).await;
    }
}

async fn run_cycle(
    app: &tauri::AppHandle,
    api: Arc<ApiClient>,
) -> Result<(), String> {
    // ── Attach to process ──────────────────────────────────────────────────
    let pid = loop {
        match memory::find_process_id("Brawlhalla.exe") {
            Some(pid) => break pid,
            None => {
                log::debug!("Waiting for Brawlhalla...");
                sleep(RECONNECT_DELAY).await;
            }
        }
    };

    let handle = memory::open_process(pid).ok_or("Failed to open process (run as admin)")?;
    let regions = memory::heap_regions(handle);
    log::info!("Attached to Brawlhalla (PID: {pid}), {} heap regions", regions.len());

    // ── Find BhID ──────────────────────────────────────────────────────────
    let my_bhid = loop {
        match scanner::find_my_bhid(handle, &regions) {
            Some(bhid) => break bhid,
            None => {
                log::debug!("Waiting for login...");
                sleep(RECONNECT_DELAY).await;
            }
        }
    };
    log::info!("Found local BhID: {my_bhid}");

    // ── Find 04c address ───────────────────────────────────────────────────
    let mut addr_04c: Option<usize> = scanner::find_04c_addr(handle, my_bhid, &regions);
    if addr_04c.is_some() {
        log::info!("Found connection state address");
    }

    // ── State machine ──────────────────────────────────────────────────────
    let mut state = ScannerState::Idle;
    let mut prev_04c: u32 = 0;
    let mut players: std::collections::HashMap<u32, scanner::PlayerInfo> = std::collections::HashMap::new();
    let mut opened: HashSet<u32> = HashSet::new();
    let mut stale_addrs: HashSet<usize> = HashSet::new();

    let mut last_scan = tokio::time::Instant::now() - SCAN_INTERVAL_SCANNING;
    let mut scan_in_flight = false;
    let detection = Arc::new(Mutex::new(DetectionState::default()));

    loop {
        // ── Try to find 04c if we don't have it yet ────────────────────
        if addr_04c.is_none() {
            addr_04c = scanner::find_04c_addr(handle, my_bhid, &regions);
            if addr_04c.is_some() {
                log::info!("Found connection state address");
            }
        }

        // ── Poll 04c ───────────────────────────────────────────────────
        if let Some(addr) = addr_04c {
            match scanner::read_04c(handle, addr) {
                Some(cur_04c) => {
                    if cur_04c != prev_04c {
                        prev_04c = cur_04c;
                        handle_state_transition(
                            cur_04c, &mut state, &mut players, &mut opened,
                            &mut stale_addrs, handle, my_bhid, &regions, app,
                        );
                    }
                }
                None => {
                    // Lost process
                    memory::close_handle(handle);
                    return Err("Brawlhalla closed".into());
                }
            }
        }

        // ── Run player scan if needed ──────────────────────────────────
        if !scan_in_flight && (state == ScannerState::Scanning || state == ScannerState::Tracking) {
            let interval = if state == ScannerState::Tracking {
                SCAN_INTERVAL_TRACKING
            } else {
                SCAN_INTERVAL_SCANNING
            };
            if last_scan.elapsed() >= interval {
                scan_in_flight = true;
                last_scan = tokio::time::Instant::now();

                let current_players = scanner::get_players(handle, my_bhid, &regions, &stale_addrs);
                players = current_players;

                // Transition from Scanning → Tracking on first results
                if !players.is_empty() && state == ScannerState::Scanning {
                    state = ScannerState::Tracking;
                    log::info!("Tracking {} players", players.len());
                }

                // Find new opponents and fetch their data
                if state == ScannerState::Tracking {
                    let opponents: Vec<_> = players.values()
                        .filter(|p| p.bhid != my_bhid && !p.is_teammate)
                        .cloned()
                        .collect();

                    let new_opponents: Vec<_> = opponents.iter()
                        .filter(|p| !opened.contains(&p.bhid))
                        .collect();

                    if !new_opponents.is_empty() {
                        let mut st = detection.lock().await;
                        if !st.match_active {
                            st.match_active = true;
                            st.local_player_id = my_bhid;

                            // Fetch opponent data concurrently
                            let mut fetches = Vec::new();
                            for opp in &new_opponents {
                                let api = Arc::clone(api);
                                let bhid = opp.bhid;
                                fetches.push(tokio::spawn(async move {
                                    api.fetch_opponent(bhid).await
                                }));
                            }

                            let mut opponent_data = Vec::new();
                            for task in fetches {
                                match task.await {
                                    Ok(Ok(data)) => opponent_data.push(data),
                                    Ok(Err(e)) => log::warn!("Failed to fetch opponent: {e}"),
                                    Err(e) => log::warn!("Fetch task panicked: {e}"),
                                }
                            }

                            if !opponent_data.is_empty() {
                                let is_ranked = new_opponents.len() == 1;
                                let payload = MatchFoundPayload {
                                    event: "match_found",
                                    opponents: opponent_data,
                                    is_ranked,
                                    local_player_id: my_bhid,
                                };
                                if let Err(e) = app.emit("game-event", &payload) {
                                    log::error!("Failed to emit match_found: {e}");
                                }
                            }
                        }

                        for opp in new_opponents {
                            opened.insert(opp.bhid);
                        }
                    }
                }

                scan_in_flight = false;
            }
        }

        sleep(POLL_INTERVAL).await;
    }
}

fn handle_state_transition(
    cur_04c: u32,
    state: &mut ScannerState,
    players: &mut std::collections::HashMap<u32, scanner::PlayerInfo>,
    opened: &mut HashSet<u32>,
    stale_addrs: &mut HashSet<usize>,
    handle: HANDLE,
    my_bhid: u32,
    regions: &[memory::MemoryRegion],
    app: &tauri::AppHandle,
) {
    if scanner::is_menu(cur_04c) {
        if *state != ScannerState::Idle {
            // Emit match_ended if we were in a match
            if *state == ScannerState::Scanning
                || *state == ScannerState::Tracking
                || *state == ScannerState::Paused
            {
                let payload = MatchEndedPayload { event: "match_ended" };
                if let Err(e) = app.emit("game-event", &payload) {
                    log::error!("Failed to emit match_ended: {e}");
                }
            }
            // Snapshot stale addresses for next scan
            *stale_addrs = scanner::snapshot_stale(handle, my_bhid, regions);
            *state = ScannerState::Idle;
            players.clear();
            opened.clear();
            log::info!("Menu");
        }
    } else if scanner::is_ignored(cur_04c) {
        // Replay, etc. — ignore
    } else if scanner::is_paused(cur_04c) {
        if *state == ScannerState::Scanning || *state == ScannerState::Tracking {
            *state = ScannerState::Paused;
            log::info!("Paused");
        }
    } else if scanner::is_char_select(cur_04c) {
        if *state == ScannerState::Idle {
            players.clear();
            opened.clear();
            log::info!("Character select");
        }
    } else if scanner::is_active_game(cur_04c) {
        if *state == ScannerState::Paused {
            *state = ScannerState::Tracking;
            log::info!("Resumed");
        } else if *state == ScannerState::Idle {
            *state = ScannerState::Scanning;
            players.clear();
            opened.clear();
            log::info!("Match detected, scanning...");
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/src/game_detection.rs
git commit -m "feat(desktop): add game detection state machine"
```

---

### Task 6: Update main.rs — Integration

**Files:**
- Modify: `apps/desktop/core/src/main.rs`

- [ ] **Step 1: Add module declarations and spawn game detection**

Add these three module declarations at the top of `main.rs` (after the existing imports, before `struct ContentBounds`):

```rust
#[cfg(target_os = "windows")]
mod api_client;
#[cfg(target_os = "windows")]
mod game_detection;
#[cfg(target_os = "windows")]
mod memory;
#[cfg(target_os = "windows")]
mod scanner;
```

Then, inside the `.setup(|app| {` closure, after the tray icon is built (before `Ok(())`), add:

```rust
// Start game detection (Windows only)
#[cfg(target_os = "windows")]
{
    let handle = app.handle().clone();
    let api_url = std::env::var("BRAWLTOME_API_URL")
        .unwrap_or_else(|_| "https://brawltome.app".into());
    tauri::async_runtime::spawn(async move {
        game_detection::run(handle, api_url).await;
    });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/desktop/core && cargo check`
Expected: compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/core/src/main.rs
git commit -m "feat(desktop): integrate game detection into main"
```

---

### Task 7: Add overlay REST endpoint to serve.ts

**Files:**
- Modify: `apps/api/src/serve.ts`

The Rust client calls `GET /api/overlay/opponent/{bhid}`. This is a plain REST endpoint, not tRPC. Add it as a Hono route directly in `serve.ts`.

- [ ] **Step 1: Add the REST route**

Add the following import at the top of `apps/api/src/serve.ts` (after existing imports):

```typescript
import { getPlayer } from './services/player.service'
import { getLegendById } from './services/game-data.service'
```

Then add the route after the `/health` route (before `const port = ...`):

```typescript
app.get('/api/overlay/opponent/:bhid', async (c) => {
  const bhid = Number(c.req.param('bhid'))
  if (!Number.isInteger(bhid) || bhid <= 0) {
    return c.json({ error: 'Invalid bhid' }, 400)
  }

  const ctx = {
    ...sharedCtx,
    clientIp: c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0',
    isBot: false,
    internalSecret: undefined,
  } as unknown as Parameters<typeof getPlayer>[0]

  const p = await getPlayer(ctx, bhid)
  if (!p) {
    return c.json({ error: 'Player not found' }, 404)
  }

  const legendKey = p.bestLegend
    ? getLegendById(p.bestLegend)?.legendNameKey ?? ''
    : ''

  const winRate = p.rankedGames > 0
    ? Math.round((p.rankedWins / p.rankedGames) * 1000) / 10
    : 0

  const playtime = p.matchTimeTotal
    ? Math.round((p.matchTimeTotal / 3600) * 10) / 10
    : 0

  return c.json({
    brawlhallaId: p.brawlhallaId,
    name: p.name,
    rating: p.rating,
    peakRating: p.peakRating ?? 0,
    playtime,
    tier: p.tier ?? 'Unranked',
    region: p.region ?? '',
    legendKey,
    winRate,
  })
})
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && bun run tsc --noEmit` (or the project's type-check command)
Expected: no type errors

- [ ] **Step 3: Test the endpoint locally**

Run: Start the API server, then `curl http://localhost:3000/api/overlay/opponent/7364605`
Expected: JSON response with opponent data fields

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/serve.ts
git commit -m "feat(api): add REST endpoint for overlay opponent data"
```

---

### Task 8: Remove mock data from useGameEvents

**Files:**
- Modify: `apps/desktop/ui/hooks/useGameEvents.ts`

- [ ] **Step 1: Remove mock data, start with empty state**

Replace the full file with:

```typescript
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import type { GameEvent, Opponent } from '../types'

export function useGameEvents() {
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [matchType, setMatchType] = useState('Players')

  useEffect(() => {
    const unlisten = listen<GameEvent>('game-event', ({ payload }) => {
      if (payload.event === 'match_found') {
        setOpponents(payload.opponents)
        setMatchType(payload.isRanked ? 'Players' : 'Custom')
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

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/ui/hooks/useGameEvents.ts
git commit -m "feat(desktop): remove mock data from game events hook"
```

---

## Manual Verification

After all tasks are complete:

1. **Build the desktop app:** `cd apps/desktop/core && cargo build`
2. **Run with Brawlhalla open:** Launch the overlay, verify it attaches to the game process
3. **Test the API endpoint:** `curl https://brawltome.app/api/overlay/opponent/7364605` (or any valid BhID)
4. **End-to-end:** Join an online match, verify opponent cards appear in the overlay
