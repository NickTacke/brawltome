//! Interactive probe for the PR-C2 IntMap-stability question.
//!
//! Hypothesis we want to settle: within a single Brawlhalla launch, does the
//! player IntMap stay at the same address across matches, or is it
//! reallocated each match? The answer determines whether PR-C2 caches once
//! per launch or once per match.
//!
//! Workflow per launch:
//!   1. Open Brawlhalla, log in
//!   2. Run this tool from an admin terminal
//!   3. Queue match 1, then in-match press Enter to take snapshot 1
//!   4. End the match, return to menu, queue match 2, then in-match press
//!      Enter to take snapshot 2
//!   5. Ctrl+C to exit
//!   6. Save the resulting session_<pid>_<launch_ts>.txt
//!
//! Repeat across 3-5 launches. Within each session file, compare the
//! "winning candidates" lines between snapshots. Same address = IntMap is at
//! the same place across matches in that launch.
//!
//! Run with:
//!   cargo run -p brawltome-desktop --bin intmap_probe --features intmap-probe-tool --release

use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use brawltome_detection::memory::{self, RegionCache};
use brawltome_detection::scanner;

use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

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

    let launch_ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let dumps_dir = PathBuf::from(local_appdata)
        .join("com.brawltome.overlay")
        .join("dumps");
    if let Err(e) = std::fs::create_dir_all(&dumps_dir) {
        eprintln!("Couldn't create {}: {}", dumps_dir.display(), e);
        std::process::exit(1);
    }
    let session_path = dumps_dir.join(format!("session_{pid}_{launch_ts}.txt"));
    println!("Session log: {}", session_path.display());

    {
        let mut f = match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&session_path)
        {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Couldn't open session file: {e}");
                std::process::exit(1);
            }
        };
        let _ = writeln!(f, "=== BrawlTome IntMap-Stability Probe Session ===");
        let _ = writeln!(f, "Brawlhalla PID: {pid}");
        let _ = writeln!(f, "Launch timestamp: {launch_ts}");
        let _ = writeln!(f, "Local BhID: {my_bhid}");
        let _ = writeln!(f, "Heap prefix: {:?}", cache.heap_prefix);
        let _ = writeln!(f, "Atom prefix: {:?}", cache.atom_prefix);
        let _ = writeln!(f);
    }

    let stdin = std::io::stdin();
    let mut handle_in = stdin.lock();
    let mut input = String::new();
    let mut snapshot_id: u32 = 0;

    loop {
        snapshot_id += 1;
        println!(
            "\n--- Press Enter to take snapshot #{snapshot_id} (Ctrl+C to exit). \
             Make sure you're already in a real matchmaking match. ---"
        );
        input.clear();
        if handle_in.read_line(&mut input).unwrap_or(0) == 0 {
            break;
        }
        capture_snapshot(handle, my_bhid, &mut cache, &session_path, snapshot_id);
    }

    unsafe {
        CloseHandle(handle);
    }
}

fn capture_snapshot(
    handle: HANDLE,
    my_bhid: u32,
    cache: &mut RegionCache,
    session_path: &Path,
    snapshot_id: u32,
) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    println!("Scanning...");

    let atom_val = (my_bhid as u64).wrapping_shl(3) | 6;
    let atom_bytes = (atom_val as u32).to_le_bytes();
    let regions: Vec<memory::MemoryRegion> = cache.regions.clone();
    let atom_addrs = memory::scan_regions(handle, &regions, &atom_bytes);

    let mut per_candidate: Vec<(usize, Vec<(u32, usize)>)> = Vec::new();
    for &addr in &atom_addrs {
        let yielded = walk_candidate(handle, addr);
        per_candidate.push((addr, yielded));
    }

    let winning: Vec<usize> = per_candidate
        .iter()
        .filter(|(_, ys)| !ys.is_empty())
        .map(|(a, _)| *a)
        .collect();

    let mut f = match OpenOptions::new().append(true).open(session_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Couldn't append to session file: {e}");
            return;
        }
    };

    let _ = writeln!(f, "=== Snapshot #{snapshot_id} (ts={now}) ===");
    let _ = writeln!(f, "Atom-match candidates ({}):", per_candidate.len());
    for (addr, ys) in &per_candidate {
        if ys.is_empty() {
            let _ = writeln!(f, "  0x{:016x} -> no valid players", addr);
        } else {
            let parts = ys
                .iter()
                .map(|(b, p)| format!("bhid={} struct=0x{:016x}", b, p))
                .collect::<Vec<_>>()
                .join("; ");
            let _ = writeln!(f, "  0x{:016x} -> {}", addr, parts);
        }
    }
    let _ = writeln!(f);
    let _ = writeln!(f, "Winning candidates ({}):", winning.len());
    for addr in &winning {
        let _ = writeln!(f, "  0x{:016x}", addr);
    }
    let _ = writeln!(f);

    println!(
        "Snapshot #{snapshot_id}: {} atom-matches, {} winning",
        per_candidate.len(),
        winning.len()
    );
    for addr in &winning {
        println!("  winning candidate: 0x{:016x}", addr);
    }
}

/// Replicate scanner::extract_players' per-candidate walk and return the
/// (bhid, struct_ptr) pairs it would have inserted. Empty vec means the
/// candidate is not a real IntMap entry (or the entries' integrity check
/// failed for every slot).
fn walk_candidate(handle: HANDLE, addr: usize) -> Vec<(u32, usize)> {
    let table_base = match addr.checked_sub(256 * 16) {
        Some(b) => b,
        None => return Vec::new(),
    };
    let mut td = vec![0u8; 512 * 16];
    if !memory::read_memory(handle, table_base, &mut td) {
        return Vec::new();
    }

    let mut yielded = Vec::new();
    let mut seen: HashSet<u32> = HashSet::new();

    for i in 0..512 {
        let off = i * 16;
        let atom = u32::from_le_bytes([td[off], td[off + 1], td[off + 2], td[off + 3]]);
        let pad = u32::from_le_bytes([td[off + 4], td[off + 5], td[off + 6], td[off + 7]]);
        if (atom & 7) != 6 || pad != 0 || atom <= 6 {
            continue;
        }
        let bhid = atom >> 3;
        if bhid == 0 || !seen.insert(bhid) {
            continue;
        }
        let raw_ptr = u64::from_le_bytes([
            td[off + 8],
            td[off + 9],
            td[off + 10],
            td[off + 11],
            td[off + 12],
            td[off + 13],
            td[off + 14],
            td[off + 15],
        ]);
        let ptr = (raw_ptr & !7) as usize;
        if ptr == 0 {
            continue;
        }
        let mut obj = [0u8; 64];
        if !memory::read_memory(handle, ptr, &mut obj) {
            continue;
        }
        let id_check = u32::from_le_bytes([obj[44], obj[45], obj[46], obj[47]]);
        let slot = u32::from_le_bytes([obj[60], obj[61], obj[62], obj[63]]);
        if id_check != bhid || slot == 0 || slot > 4 {
            continue;
        }
        yielded.push((bhid, ptr));
    }

    yielded
}
