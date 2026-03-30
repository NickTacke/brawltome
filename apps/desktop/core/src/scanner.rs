use std::collections::HashMap;
use std::collections::HashSet;

use crate::memory;
use crate::memory::RegionCache;

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
    cache: &mut RegionCache,
) -> Option<u32> {
    let pattern: &[u8] = &[0x00, b'h', b'I', b'D', 0x00];
    let addrs = memory::scan_heap(handle, cache, pattern);
    cache.learn_prefix(&addrs);

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
    cache: &RegionCache,
) -> Option<usize> {
    let bhid_bytes = my_bhid.to_le_bytes();
    let addrs = memory::scan_heap(handle, cache, &bhid_bytes);

    log::debug!("find_04c: {} BhID matches across heap regions", addrs.len());
    for ba in &addrs {
        let candidate = ba + BHID_04C_OFFSET;
        if let Some(val) = memory::read::<u32>(handle, candidate) {
            log::debug!("find_04c: addr=0x{:x} candidate=0x{:x} val={} valid={}", ba, candidate, val, VALID_STATES.contains(&val));
            if VALID_STATES.contains(&val) {
                return Some(candidate);
            }
        }
    }

    // If heap-only scan failed, try all regions as fallback
    if !addrs.is_empty() {
        log::debug!("find_04c: no valid state in heap regions, trying all regions");
        let all_addrs = memory::scan_regions_with_buf(handle, &cache.regions, &my_bhid.to_le_bytes(), &mut Vec::new());
        for ba in &all_addrs {
            let candidate = ba + BHID_04C_OFFSET;
            if let Some(val) = memory::read::<u32>(handle, candidate) {
                if VALID_STATES.contains(&val) {
                    log::debug!("find_04c: found in non-heap region at 0x{:x} val={}", candidate, val);
                    return Some(candidate);
                }
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

/// Diagnostic: dump bytes around each BhID match to understand data layout.
pub fn dump_bhid_context(
    handle: windows_sys::Win32::Foundation::HANDLE,
    my_bhid: u32,
    cache: &RegionCache,
) {
    let bhid_bytes = my_bhid.to_le_bytes();
    let addrs = memory::scan_heap(handle, cache, &bhid_bytes);
    log::debug!("dump_bhid_context: {} raw BhID matches for {}", addrs.len(), my_bhid);

    // Also try the atom encoding
    let atom_u32 = ((my_bhid as u64).wrapping_shl(3) | 6) as u32;
    let atom_bytes = atom_u32.to_le_bytes();
    let atom_addrs = memory::scan_heap(handle, cache, &atom_bytes);
    log::debug!("dump_bhid_context: {} atom (<<3|6) matches for 0x{:08X}", atom_addrs.len(), atom_u32);

    // Try u64 atom
    let atom_u64 = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_u64_bytes = atom_u64.to_le_bytes();
    let atom64_addrs = memory::scan_heap(handle, cache, &atom_u64_bytes);
    log::debug!("dump_bhid_context: {} u64 atom matches for 0x{:016X}", atom64_addrs.len(), atom_u64);

    // Dump context around first few BhID matches
    for (idx, &addr) in addrs.iter().take(3).enumerate() {
        let start = addr.saturating_sub(32);
        let mut ctx = vec![0u8; 128];
        if memory::read_memory(handle, start, &mut ctx) {
            let hex: Vec<String> = ctx.iter().map(|b| format!("{:02x}", b)).collect();
            let offset = addr - start;
            log::debug!("BhID match #{} at 0x{:x} (offset {} in dump):\n  {}",
                idx, addr, offset, hex.chunks(16)
                    .enumerate()
                    .map(|(i, c)| format!("{:04x}: {}", i*16, c.join(" ")))
                    .collect::<Vec<_>>()
                    .join("\n  "));
        }
    }
}

/// Max region size for player scanning (10 MB). Game structures live in
/// small-to-medium heap regions; skipping huge allocations saves ~50%+ time.
const PLAYER_SCAN_MAX_REGION: usize = 10 * 1024 * 1024;

/// Extract all players from the process heap by scanning for IntMap atoms.
pub fn get_players(
    handle: windows_sys::Win32::Foundation::HANDLE,
    my_bhid: u32,
    cache: &RegionCache,
    stale_addrs: &HashSet<usize>,
) -> PlayerMap {
    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let mut addrs = memory::scan_heap_small(handle, cache, &atom_bytes, PLAYER_SCAN_MAX_REGION);
    if addrs.is_empty() {
        // Fall back to full heap scan (still prefix-filtered)
        addrs = memory::scan_heap(handle, cache, &atom_bytes);
    }
    if addrs.is_empty() {
        // Last resort: scan ALL regions ignoring prefix
        addrs = memory::scan_regions_with_buf(handle, &cache.regions, &atom_bytes, &mut Vec::new());
        if !addrs.is_empty() {
            log::info!("get_players: found {} matches outside heap prefix — prefix may be stale", addrs.len());
            // Update prefix from these results
        }
    }
    log::debug!("get_players: {} atom matches for 0x{:08X}", addrs.len(), atom_val as u32);

    let mut players = PlayerMap::new();

    for &addr in &addrs {
        if stale_addrs.contains(&addr) {
            continue;
        }

        // Read the 512-entry IntMap table centered around the found atom.
        let table_base = match addr.checked_sub(256 * 16) {
            Some(b) => b,
            None => { log::trace!("get_players: addr 0x{:x} too low for table", addr); continue; },
        };
        let mut td = vec![0u8; 512 * 16];
        if !memory::read_memory(handle, table_base, &mut td) {
            log::trace!("get_players: failed to read table at 0x{:x}", table_base);
            continue;
        }

        let mut atoms_found = 0u32;
        for i in 0..512 {
            let off = i * 16;

            let atom = u32::from_le_bytes([td[off], td[off + 1], td[off + 2], td[off + 3]]);
            let pad = u32::from_le_bytes([td[off + 4], td[off + 5], td[off + 6], td[off + 7]]);

            if (atom & 7) != 6 || pad != 0 || atom <= 6 {
                continue;
            }
            atoms_found += 1;
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

            // Read 64-byte player object (matching Python: pm.read_bytes(ptr, 64))
            let mut obj = [0u8; 64];
            if !memory::read_memory(handle, ptr, &mut obj) {
                log::trace!("get_players: failed to read obj at 0x{:x} for bhid={}", ptr, bhid);
                continue;
            }

            let id_check = u32::from_le_bytes([obj[44], obj[45], obj[46], obj[47]]);
            let slot = u32::from_le_bytes([obj[60], obj[61], obj[62], obj[63]]);

            if id_check != bhid || slot == 0 {
                log::debug!("get_players: bhid={} id_check={} slot={} (rejected)", bhid, id_check, slot);
                continue;
            }

            // SNID
            let snid = if let Some(snid_raw) = memory::read::<u64>(handle, ptr + 64) {
                let snid_ptr = (snid_raw & !7) as usize;
                memory::read_tamarin_string(handle, snid_ptr).unwrap_or_default()
            } else {
                String::new()
            };

            // Name (nested pointer: +80 -> +56 -> string)
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

            log::debug!("get_players: found bhid={} name='{}' slot={}", bhid, name, slot);
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
        log::debug!("get_players: table at 0x{:x} had {} atoms, {} players so far", table_base, atoms_found, players.len());
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
    cache: &RegionCache,
) -> HashSet<usize> {
    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let addrs = memory::scan_heap_small(handle, cache, &atom_bytes, PLAYER_SCAN_MAX_REGION);
    addrs.into_iter().collect()
}
