//! Standalone debug binary for the PR-C2 pointer-chain investigation.
//!
//! Run this from a terminal while you're in an actual matchmaking match
//! (custom rooms use a different code path and would point at the wrong
//! IntMap). It opens Brawlhalla.exe, runs the existing scanner logic to
//! locate the player IntMap entries / 04c address / local BhID, then writes
//! a `.txt` file documenting:
//!
//! - Brawlhalla.exe module base + size (so any address can be expressed as
//!   `module + offset`, which is what Cheat Engine pointer-scan needs as
//!   the "stable anchor" output).
//! - Local BhID and the address where its u32 value lives.
//! - 04c (connection-state) address.
//! - Every IntMap atom-match address (each is inside an IntMap entry; the
//!   IntMap base sits 16-byte-aligned somewhere before each match).
//! - Every player struct pointer (raw + module-relative).
//! - First 96 bytes of each player struct, hex dumped with field offsets
//!   annotated, so layout drift is visible at a glance.
//!
//! Usage:
//!   cargo run -p brawltome-desktop --bin dump_layout
//!
//! After capturing a `.txt` per match, also right-click Brawlhalla.exe in
//! Task Manager and "Create dump file". Save the .DMP alongside the .txt.
//! Cheat Engine can attach to the .DMP for offline pointer scanning, so
//! you only need the live process for the brief capture window.
//!
//! Repeat over 5+ matches across 5+ Brawlhalla launches to gather enough
//! snapshots that pointer-chain stability across launches can be verified
//! offline.

use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::mem;
use std::path::PathBuf;
use std::time::SystemTime;

use brawltome_detection::memory::{self, RegionCache};
use brawltome_detection::scanner;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
    TH32CS_SNAPMODULE32,
};

const INVALID_HANDLE: HANDLE = -1isize as HANDLE;

fn main() {
    let pid = match memory::find_process_id("Brawlhalla.exe") {
        Some(p) => p,
        None => {
            eprintln!("Brawlhalla.exe not running");
            std::process::exit(1);
        }
    };
    println!("Brawlhalla.exe PID: {pid}");

    let handle = match memory::open_process(pid) {
        Some(h) => h,
        None => {
            eprintln!("Failed to open process (run terminal as admin)");
            std::process::exit(1);
        }
    };

    let modules = enumerate_modules(pid);
    if modules.is_empty() {
        eprintln!("Couldn't enumerate modules");
        std::process::exit(1);
    }
    println!("Modules loaded: {}", modules.len());
    // Largest few likely include the Adobe AIR runtime (where game code lives,
    // not Brawlhalla.exe which is just a small shim launcher).
    let mut by_size = modules.clone();
    by_size.sort_by(|a, b| b.size.cmp(&a.size));
    for m in by_size.iter().take(5) {
        println!(
            "  {:>10} bytes ({:>5.1} MB)  base 0x{:016x}  {}",
            m.size,
            m.size as f64 / 1048576.0,
            m.base,
            m.name
        );
    }

    let regions = memory::heap_regions(handle);
    let mut cache = RegionCache::new(regions);
    println!("Region cache built: {} regions", cache.regions.len());

    let my_bhid = match scanner::find_my_bhid(handle, &mut cache) {
        Some(b) => b,
        None => {
            eprintln!("Local BhID not found (are you logged in?)");
            std::process::exit(1);
        }
    };
    println!("Local BhID: {my_bhid}");

    let bhid_value_addr = locate_bhid_value(handle, my_bhid, &cache);

    let addr_04c = scanner::find_04c_addr(handle, my_bhid, &cache);
    println!("04c address: {:?}", addr_04c.map(|a| format!("0x{:016x}", a)));

    // Pull atom-match addresses BEFORE get_players (which clears them via
    // its internal logic). We re-scan here directly so we have the raw
    // addresses for the dump.
    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let regions: Vec<memory::MemoryRegion> = cache.regions.clone();
    let atom_addrs = memory::scan_regions(handle, &regions, &atom_bytes);
    println!("IntMap atom matches: {}", atom_addrs.len());

    let players = scanner::get_players(handle, my_bhid, &mut cache, &HashSet::new());
    println!("Players: {}", players.len());
    for (bhid, p) in &players {
        println!("  bhid={} slot={} name={:?}", bhid, p.slot, p.name);
    }

    // Dump file path
    let local_appdata =
        std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let dumps_dir = PathBuf::from(local_appdata)
        .join("com.brawltome.overlay")
        .join("dumps");
    if let Err(e) = std::fs::create_dir_all(&dumps_dir) {
        eprintln!("Couldn't create {}: {}", dumps_dir.display(), e);
        std::process::exit(1);
    }
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let txt_path = dumps_dir.join(format!("dump_{stamp}.txt"));

    let mut f = match File::create(&txt_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Failed to create {}: {}", txt_path.display(), e);
            std::process::exit(1);
        }
    };

    let _ = writeln!(f, "=== BrawlTome PR-C2 Layout Dump ===");
    let _ = writeln!(f, "Captured: {stamp} (UTC seconds since epoch)");
    let _ = writeln!(f, "Brawlhalla.exe PID: {pid}");
    let _ = writeln!(f, "Heap prefix:  {:?}", cache.heap_prefix);
    let _ = writeln!(f, "Atom prefix:  {:?}", cache.atom_prefix);
    let _ = writeln!(f);

    let _ = writeln!(
        f,
        "=== Loaded modules ({}, sorted by size) ===",
        modules.len()
    );
    let _ = writeln!(
        f,
        "Brawlhalla.exe is a tiny shim. Game code lives in the largest non-system DLLs"
    );
    let _ = writeln!(
        f,
        "(typically Adobe AIR / Flash runtime). Pointer-scan static anchors come from these."
    );
    let _ = writeln!(f);
    for m in by_size.iter().take(20) {
        let _ = writeln!(
            f,
            "  {:>10} bytes ({:>5.1} MB)  base 0x{:016x}..0x{:016x}  {}",
            m.size,
            m.size as f64 / 1048576.0,
            m.base,
            m.base + m.size,
            m.name
        );
    }
    let _ = writeln!(f);

    let _ = writeln!(f, "=== Local Player ===");
    let _ = writeln!(f, "BhID: {my_bhid}");
    if let Some(addr) = bhid_value_addr {
        let _ = writeln!(
            f,
            "BhID value address: 0x{:016x} ({})",
            addr,
            address_in_modules(&modules, addr)
        );
    } else {
        let _ = writeln!(f, "BhID value address: <not located>");
    }
    if let Some(addr) = addr_04c {
        let _ = writeln!(
            f,
            "04c address:        0x{:016x} ({})",
            addr,
            address_in_modules(&modules, addr)
        );
    } else {
        let _ = writeln!(f, "04c address:        <not located>");
    }
    let _ = writeln!(f);

    let _ = writeln!(
        f,
        "=== IntMap atom matches ({} total; first 64 listed) ===",
        atom_addrs.len()
    );
    let _ = writeln!(
        f,
        "Each address is inside a 16-byte IntMap entry [atom u32 | pad u32 | ptr u64]."
    );
    let _ = writeln!(
        f,
        "The IntMap base is at addr - (entry_index * 16). Pointer-scan this address in CE."
    );
    let _ = writeln!(f);
    for (i, addr) in atom_addrs.iter().take(64).enumerate() {
        let _ = writeln!(
            f,
            "  [{i:>3}] 0x{:016x} ({})",
            addr,
            address_in_modules(&modules, *addr)
        );
    }
    let _ = writeln!(f);

    let _ = writeln!(f, "=== Player struct addresses ===");
    let _ = writeln!(
        f,
        "These are pointers from IntMap entries' ptr field, masked with !7 (NekoVM tag bits)."
    );
    let _ = writeln!(f);
    let mut written = HashSet::new();
    for (bhid, _player) in &players {
        if let Some(struct_addr) = locate_player_struct(handle, *bhid, &atom_addrs) {
            if !written.insert(struct_addr) {
                continue;
            }
            let _ = writeln!(
                f,
                "Player BhID {} at 0x{:016x} ({}):",
                bhid,
                struct_addr,
                address_in_modules(&modules, struct_addr)
            );
            let mut buf = [0u8; 96];
            if memory::read_memory(handle, struct_addr, &mut buf) {
                write_player_hex(&mut f, &buf);
            } else {
                let _ = writeln!(f, "  (read failed)");
            }
            let _ = writeln!(f);
        }
    }

    println!("\nDump written: {}", txt_path.display());
    println!(
        "\nNext: open Task Manager -> right-click Brawlhalla.exe -> Create dump file."
    );
    println!("Save the .DMP alongside this .txt for offline Cheat Engine analysis.");

    unsafe {
        CloseHandle(handle);
    }
}

#[derive(Debug, Clone)]
struct Module {
    name: String,
    base: usize,
    size: usize,
}

fn enumerate_modules(pid: u32) -> Vec<Module> {
    let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
    if snap == INVALID_HANDLE {
        return Vec::new();
    }
    let mut me = MODULEENTRY32W {
        dwSize: mem::size_of::<MODULEENTRY32W>() as u32,
        ..unsafe { mem::zeroed() }
    };
    let mut modules = Vec::new();
    if unsafe { Module32FirstW(snap, &mut me) } != 0 {
        loop {
            let name: String = me
                .szModule
                .iter()
                .take_while(|&&c| c != 0)
                .map(|&c| c as u8 as char)
                .collect();
            modules.push(Module {
                name,
                base: me.modBaseAddr as usize,
                size: me.modBaseSize as usize,
            });
            if unsafe { Module32NextW(snap, &mut me) } == 0 {
                break;
            }
        }
    }
    unsafe { CloseHandle(snap) };
    modules
}

fn address_in_modules(modules: &[Module], addr: usize) -> String {
    for m in modules {
        if addr >= m.base && addr < m.base + m.size {
            return format!("{} + 0x{:x}", m.name, addr - m.base);
        }
    }
    let prefix = (addr >> 32) as u32;
    format!("heap (prefix 0x{:08x})", prefix)
}

/// Find the address where the local BhID value lives in memory by replicating
/// `find_my_bhid`'s pattern logic. Used so the dump can record the raw u32
/// address for cross-referencing with Cheat Engine.
fn locate_bhid_value(handle: HANDLE, my_bhid: u32, cache: &RegionCache) -> Option<usize> {
    let pattern: &[u8] = &[0x00, b'h', b'I', b'D', 0x00];
    let regions: Vec<memory::MemoryRegion> = cache.regions.clone();
    let addrs = memory::scan_regions(handle, &regions, pattern);
    for addr in addrs {
        if addr >= 24 {
            if let Some(v) = memory::read::<u32>(handle, addr - 24) {
                if v == my_bhid {
                    return Some(addr - 24);
                }
            }
        }
    }
    None
}

/// Walk atom-match addresses and dereference the IntMap entry's pointer to
/// find the player struct address for a given BhID.
fn locate_player_struct(handle: HANDLE, bhid: u32, atom_addrs: &[usize]) -> Option<usize> {
    let target_atom = ((bhid as u64) << 3) | 6;
    let target_atom_u32 = target_atom as u32;
    for &addr in atom_addrs {
        // Each match is the start of an atom u32. Read the entry: atom (u32),
        // pad (u32), ptr (u64). If atom matches AND pad is 0, follow the ptr.
        let mut entry = [0u8; 16];
        if !memory::read_memory(handle, addr, &mut entry) {
            continue;
        }
        let atom = u32::from_le_bytes([entry[0], entry[1], entry[2], entry[3]]);
        let pad = u32::from_le_bytes([entry[4], entry[5], entry[6], entry[7]]);
        if atom != target_atom_u32 || pad != 0 {
            continue;
        }
        let raw_ptr = u64::from_le_bytes([
            entry[8], entry[9], entry[10], entry[11], entry[12], entry[13], entry[14], entry[15],
        ]);
        let ptr = (raw_ptr & !7) as usize;
        if ptr == 0 {
            continue;
        }
        return Some(ptr);
    }
    None
}

fn write_player_hex<W: Write>(w: &mut W, buf: &[u8]) {
    // 16 bytes per row, 6 rows = 96 bytes. Annotate known field offsets in
    // the right margin so layout drift is visible when comparing across
    // captures or vs scanner.rs constants.
    let annotations: &[(usize, &str)] = &[
        (44, "+44 = bhid (u32)"),
        (60, "+60 = slot (u32)"),
        (64, "+64 = snid_ptr (u64)"),
        (80, "+80 = nested_ptr (u64)"),
    ];
    for row in 0..(buf.len() / 16) {
        let off = row * 16;
        let bytes: String = (0..16)
            .map(|i| format!("{:02x}", buf[off + i]))
            .collect::<Vec<_>>()
            .join(" ");
        let mut note = String::new();
        for (a_off, a_text) in annotations {
            if *a_off >= off && *a_off < off + 16 {
                if !note.is_empty() {
                    note.push_str(", ");
                }
                note.push_str(a_text);
            }
        }
        if note.is_empty() {
            let _ = writeln!(w, "  +{:>2}..{:>2}: {}", off, off + 15, bytes);
        } else {
            let _ = writeln!(w, "  +{:>2}..{:>2}: {}    // {}", off, off + 15, bytes, note);
        }
    }
}
