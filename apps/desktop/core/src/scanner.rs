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
