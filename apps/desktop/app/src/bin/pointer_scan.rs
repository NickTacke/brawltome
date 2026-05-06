//! PR-C2 research tool: backward pointer-scan against the .dmp files
//! produced alongside dump_layout.rs's .txt files.
//!
//! Goal: find a stable pointer chain from a static module (Adobe AIR.dll,
//! amdxx64.dll, etc.) to one of the player-struct addresses captured in the
//! .txt. A "stable" chain holds the same `(module + module_offset, [step
//! offsets])` template across all 5 dumps; per-launch base addresses differ
//! but the offsets stay constant.
//!
//! Run from the repo root:
//!   cargo run -p brawltome-desktop --bin pointer_scan --features pointer-scan-tool --release
//!
//! Reads every `dump_<ts>.dmp` + `dump_<ts>.txt` pair under
//! %LOCALAPPDATA%\com.brawltome.overlay\dumps\, processes them in turn, and
//! prints a ranked summary plus a markdown report to
//! `%LOCALAPPDATA%\com.brawltome.overlay\dumps\pointer_scan_report.md`.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use minidump::{
    Minidump, MinidumpMemoryList, MinidumpMemory64List, MinidumpModuleList, Module,
    UnifiedMemoryList,
};

const MAX_DEPTH: usize = 8;
const DISPLACEMENT: i64 = 2048;
/// Cap on how many distinct pointer addresses we recurse from per level. The
/// number can explode combinatorially without this bound. Raised to capture
/// more candidates per level; cross-dump intersection eliminates noise.
const MAX_FANOUT_PER_LEVEL: usize = 256;
/// Cap on total chains collected per dump; safety against pathological cases.
const MAX_CHAINS_PER_DUMP: usize = 100_000;

#[derive(Clone, Debug)]
struct Module64 {
    name: String,
    base: u64,
    size: u64,
}

#[derive(Clone, Debug)]
struct MemRegion {
    base: u64,
    bytes: Vec<u8>,
}

struct DumpCtx {
    label: String,
    txt_path: PathBuf,
    modules: Vec<Module64>,
    memory: Vec<MemRegion>,
    pointer_index: HashMap<u64, Vec<u64>>,
    /// Player struct addresses extracted from the .txt file. These are
    /// the pointer-scan targets.
    targets: Vec<u64>,
    /// Heap prefix (top-32-bit pattern of heap allocations) parsed from .txt.
    heap_prefix: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ChainTemplate {
    module: String,
    module_offset: u64,
    /// Step offsets applied as `(read_u64(addr) & !7) + step_offset`.
    /// Stored signed because games often use negative offsets to reach a
    /// previous-field anchor in a struct.
    steps: Vec<i64>,
}

#[derive(Clone, Debug)]
struct ScoredChain {
    template: ChainTemplate,
    /// dump_label -> resolved target (or None if chain didn't resolve)
    resolutions: Vec<(String, Option<u64>)>,
}

impl ScoredChain {
    fn confirmed_count(&self) -> usize {
        self.resolutions
            .iter()
            .filter(|(_, r)| r.is_some())
            .count()
    }
    fn total_count(&self) -> usize {
        self.resolutions.len()
    }
}

fn main() {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let dumps_dir = PathBuf::from(local_appdata)
        .join("com.brawltome.overlay")
        .join("dumps");

    println!("Reading dumps from: {}", dumps_dir.display());

    let pairs = discover_dump_pairs(&dumps_dir);
    if pairs.is_empty() {
        eprintln!("No (.dmp, .txt) pairs found in {}", dumps_dir.display());
        std::process::exit(1);
    }
    println!("Found {} dump pair(s)", pairs.len());

    let mut contexts = Vec::new();
    for (dmp, txt) in &pairs {
        let label = dmp
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("?")
            .to_string();
        println!("\n=== Loading {} ===", label);
        match load_dump(&label, dmp, txt) {
            Ok(ctx) => {
                println!(
                    "  modules: {}, memory regions: {}, total bytes: {:.1} MB, pointer-index entries: {}, targets: {}",
                    ctx.modules.len(),
                    ctx.memory.len(),
                    ctx.memory.iter().map(|r| r.bytes.len()).sum::<usize>() as f64 / 1048576.0,
                    ctx.pointer_index.len(),
                    ctx.targets.len(),
                );
                contexts.push(ctx);
            }
            Err(e) => {
                eprintln!("  load failed: {}", e);
            }
        }
    }

    if contexts.len() < 2 {
        eprintln!(
            "Need at least 2 successfully-loaded dumps to cross-reference; got {}",
            contexts.len()
        );
        std::process::exit(1);
    }

    // Scan each dump INDEPENDENTLY for backward chains. A template that is
    // discovered as a candidate in multiple dumps is way more likely to be
    // stable than one that only happened to resolve by chance via cross-
    // reference forward-resolve.
    println!("\n=== Pointer-scanning each dump independently ===");
    let scan_start = Instant::now();

    // template -> set of dump labels that found it as a candidate
    let mut template_to_dumps: HashMap<ChainTemplate, Vec<String>> = HashMap::new();
    for ctx in &contexts {
        let mut per_dump_templates: HashMap<ChainTemplate, ()> = HashMap::new();
        for &target in &ctx.targets {
            let chains = backward_scan(ctx, target, MAX_DEPTH);
            for c in chains {
                per_dump_templates.entry(c).or_default();
                if per_dump_templates.len() >= MAX_CHAINS_PER_DUMP {
                    break;
                }
            }
        }
        println!(
            "  {}: {} unique chain template(s) from {} target(s)",
            ctx.label,
            per_dump_templates.len(),
            ctx.targets.len()
        );
        for (t, _) in per_dump_templates {
            template_to_dumps.entry(t).or_default().push(ctx.label.clone());
        }
    }
    println!(
        "\n=== Backward scan total elapsed: {:.1}s; {} distinct templates across all dumps ===",
        scan_start.elapsed().as_secs_f64(),
        template_to_dumps.len()
    );

    // Stability bucket of "found as candidate in N dumps".
    let mut found_in_n_dumps: HashMap<usize, usize> = HashMap::new();
    for (_, found_dumps) in &template_to_dumps {
        *found_in_n_dumps.entry(found_dumps.len()).or_default() += 1;
    }
    let mut bks: Vec<(usize, usize)> = found_in_n_dumps.into_iter().collect();
    bks.sort_by(|a, b| b.0.cmp(&a.0));
    println!("\n=== Candidates discovered in N dumps ===");
    for (n, count) in &bks {
        println!("  {}/{}: {} chain(s)", n, contexts.len(), count);
    }

    // For each template, do forward-resolve in EVERY dump to compute the
    // landing-on-correct-target stability.
    println!("\n=== Forward-resolving candidates in every dump ===");
    let xref_start = Instant::now();
    let mut scored: Vec<ScoredChain> = Vec::new();
    for (template, _found_in) in template_to_dumps.iter() {
        let mut resolutions: Vec<(String, Option<u64>)> = Vec::new();
        for ctx in &contexts {
            let resolved = resolve_chain(ctx, template);
            let valid = resolved.map(|a| {
                ctx.targets
                    .iter()
                    .any(|&t| (a as i64 - t as i64).abs() <= DISPLACEMENT)
            });
            resolutions.push((
                ctx.label.clone(),
                if valid.unwrap_or(false) { resolved } else { None },
            ));
        }
        scored.push(ScoredChain {
            template: template.clone(),
            resolutions,
        });
    }

    // Sort by confirmed count (forward-resolves to a valid target) descending,
    // then by depth ascending (shorter chains preferred when tied).
    scored.sort_by(|a, b| {
        let ac = a.confirmed_count();
        let bc = b.confirmed_count();
        bc.cmp(&ac)
            .then_with(|| a.template.steps.len().cmp(&b.template.steps.len()))
    });

    println!(
        "\n=== Forward-resolve done in {:.1}s ===",
        xref_start.elapsed().as_secs_f64()
    );

    // Print the top results.
    let total_dumps = contexts.len();
    let mut bucket_counts: HashMap<usize, usize> = HashMap::new();
    for sc in &scored {
        *bucket_counts.entry(sc.confirmed_count()).or_default() += 1;
    }
    println!("\n=== Stability distribution ===");
    let mut buckets: Vec<(usize, usize)> = bucket_counts.into_iter().collect();
    buckets.sort_by(|a, b| b.0.cmp(&a.0));
    for (confirmed, count) in &buckets {
        println!("  {}/{} dumps confirmed: {} chain(s)", confirmed, total_dumps, count);
    }

    println!("\n=== Top 20 chains (by confirmed count, then by depth) ===");
    for sc in scored.iter().take(20) {
        print_chain_summary(sc, total_dumps);
    }

    let report_path = dumps_dir.join("pointer_scan_report.md");
    write_report(&report_path, &contexts, &scored, total_dumps);
    println!("\nReport written: {}", report_path.display());
}

fn discover_dump_pairs(dir: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut pairs = Vec::new();
    if !dir.is_dir() {
        return pairs;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return pairs,
    };
    let mut dmps: Vec<PathBuf> = Vec::new();
    let mut txts: HashMap<String, PathBuf> = HashMap::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let stem = match p.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        match p.extension().and_then(|e| e.to_str()) {
            Some("dmp") => dmps.push(p),
            Some("txt") => {
                txts.insert(stem, p);
            }
            _ => {}
        }
    }
    for d in dmps {
        let stem = d.file_stem().and_then(|s| s.to_str()).map(String::from);
        if let Some(stem) = stem {
            if let Some(txt) = txts.get(&stem) {
                pairs.push((d.clone(), txt.clone()));
            }
        }
    }
    pairs.sort();
    pairs
}

fn load_dump(
    label: &str,
    dmp_path: &Path,
    txt_path: &Path,
) -> Result<DumpCtx, String> {
    let load_start = Instant::now();
    let dump = Minidump::read_path(dmp_path).map_err(|e| format!("minidump open: {e}"))?;
    println!("  parsed minidump headers in {:.2}s", load_start.elapsed().as_secs_f64());

    let module_list: MinidumpModuleList = dump
        .get_stream::<MinidumpModuleList>()
        .map_err(|e| format!("module list: {e}"))?;
    let modules: Vec<Module64> = module_list
        .iter()
        .map(|m| Module64 {
            name: PathBuf::from(m.name.clone())
                .file_name()
                .and_then(|n| n.to_str())
                .map(String::from)
                .unwrap_or_else(|| m.name.clone()),
            base: m.base_address(),
            size: m.size(),
        })
        .collect();

    // Prefer 64-bit memory list (full memory dumps); fall back to 32-bit.
    let memory: Vec<MemRegion> = if let Ok(list) = dump.get_stream::<MinidumpMemory64List>() {
        let unified = UnifiedMemoryList::Memory64(list);
        unified
            .iter()
            .map(|m| MemRegion {
                base: m.base_address(),
                bytes: m.bytes().to_vec(),
            })
            .collect()
    } else if let Ok(list) = dump.get_stream::<MinidumpMemoryList>() {
        let unified = UnifiedMemoryList::Memory(list);
        unified
            .iter()
            .map(|m| MemRegion {
                base: m.base_address(),
                bytes: m.bytes().to_vec(),
            })
            .collect()
    } else {
        return Err("no memory list in dump".to_string());
    };

    if memory.is_empty() {
        return Err("memory list empty (was the dump captured as a full-memory dump?)".to_string());
    }

    let total_bytes: usize = memory.iter().map(|r| r.bytes.len()).sum();
    println!(
        "  loaded {} memory region(s), {} MB total in {:.2}s",
        memory.len(),
        total_bytes / 1048576,
        load_start.elapsed().as_secs_f64()
    );

    // Build pointer index (only u64 values that look like valid pointers into
    // memory or modules — drops 99%+ of random-data u64s).
    let valid_ranges = build_valid_ranges(&memory, &modules);
    let index_start = Instant::now();
    let mut pointer_index: HashMap<u64, Vec<u64>> = HashMap::new();
    for region in &memory {
        let bytes = &region.bytes;
        let len = bytes.len();
        // Walk 8-byte-aligned u64 slots.
        let mut off = 0;
        while off + 8 <= len {
            let val = u64::from_le_bytes([
                bytes[off],
                bytes[off + 1],
                bytes[off + 2],
                bytes[off + 3],
                bytes[off + 4],
                bytes[off + 5],
                bytes[off + 6],
                bytes[off + 7],
            ]) & !7;
            if is_valid_pointer(val, &valid_ranges) {
                let here = region.base + off as u64;
                pointer_index.entry(val).or_default().push(here);
            }
            off += 8;
        }
    }
    println!(
        "  pointer index built in {:.2}s ({} unique values, ~{} entries)",
        index_start.elapsed().as_secs_f64(),
        pointer_index.len(),
        pointer_index.values().map(|v| v.len()).sum::<usize>(),
    );

    // Parse the matching .txt for player-struct targets.
    let txt = fs::read_to_string(txt_path).map_err(|e| format!("read txt: {e}"))?;
    let (targets, heap_prefix) = parse_txt(&txt);

    Ok(DumpCtx {
        label: label.to_string(),
        txt_path: txt_path.to_path_buf(),
        modules,
        memory,
        pointer_index,
        targets,
        heap_prefix,
    })
}

fn build_valid_ranges(
    memory: &[MemRegion],
    modules: &[Module64],
) -> Vec<(u64, u64)> {
    let mut r: Vec<(u64, u64)> = Vec::new();
    for region in memory {
        r.push((region.base, region.base + region.bytes.len() as u64));
    }
    for m in modules {
        r.push((m.base, m.base + m.size));
    }
    r.sort_by_key(|(a, _)| *a);
    // Merge adjacent/overlapping ranges.
    let mut merged: Vec<(u64, u64)> = Vec::new();
    for (s, e) in r {
        if let Some(last) = merged.last_mut() {
            if s <= last.1 {
                last.1 = last.1.max(e);
                continue;
            }
        }
        merged.push((s, e));
    }
    merged
}

fn is_valid_pointer(val: u64, ranges: &[(u64, u64)]) -> bool {
    if val == 0 {
        return false;
    }
    // Quick reject on obviously-garbage upper bits.
    if val >> 48 != 0 {
        return false;
    }
    // Binary search the merged range list.
    match ranges.binary_search_by(|(s, _)| s.cmp(&val)) {
        Ok(_) => true, // exact start of a range
        Err(idx) => {
            if idx == 0 {
                return false;
            }
            let (s, e) = ranges[idx - 1];
            val >= s && val < e
        }
    }
}

/// Parse the dump_layout.rs .txt for the player-struct addresses + heap prefix.
fn parse_txt(txt: &str) -> (Vec<u64>, Option<u32>) {
    let mut targets = Vec::new();
    let mut heap_prefix: Option<u32> = None;
    for line in txt.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Heap prefix:") {
            // "Heap prefix:  Some(489)"
            if let Some(start) = rest.find("Some(") {
                let after = &rest[start + 5..];
                if let Some(end) = after.find(')') {
                    if let Ok(p) = after[..end].parse::<u32>() {
                        heap_prefix = Some(p);
                    }
                }
            }
        }
        if let Some(addr_str) = l.strip_prefix("Player BhID ") {
            // "Player BhID 5787742 at 0x000003859105ee48 (heap (...))"
            if let Some(at_idx) = addr_str.find(" at 0x") {
                let after = &addr_str[at_idx + 6..];
                let hex: String = after.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
                if let Ok(a) = u64::from_str_radix(&hex, 16) {
                    targets.push(a);
                }
            }
        }
    }
    targets.sort();
    targets.dedup();
    (targets, heap_prefix)
}

/// Backward search: from `target`, find chains of length up to `max_depth`
/// terminating at a static-module anchor.
fn backward_scan(ctx: &DumpCtx, target: u64, max_depth: usize) -> Vec<ChainTemplate> {
    // BFS-ish, accumulating chains. Each work item = (current_target,
    // accumulated_steps_so_far_reversed).
    let mut results: Vec<ChainTemplate> = Vec::new();
    let mut visited: HashMap<u64, ()> = HashMap::new();

    // (current_target, steps_collected_in_reverse_order)
    let mut stack: Vec<(u64, Vec<i64>)> = vec![(target, Vec::new())];

    while let Some((curr, steps)) = stack.pop() {
        if steps.len() >= max_depth {
            continue;
        }

        // Pull pointer addresses landing on curr ± DISPLACEMENT.
        let mut hits = pointers_near(ctx, curr, DISPLACEMENT);
        if hits.len() > MAX_FANOUT_PER_LEVEL {
            // Sort hits with a deterministic order so different invocations of
            // the tool don't flap. Prefer smaller positive deltas, then by
            // module-anchor first (more useful for stability).
            hits.sort_by(|a, b| {
                let a_in_module = find_module(&ctx.modules, a.0).is_some();
                let b_in_module = find_module(&ctx.modules, b.0).is_some();
                b_in_module
                    .cmp(&a_in_module)
                    .then_with(|| a.1.abs().cmp(&b.1.abs()))
            });
            hits.truncate(MAX_FANOUT_PER_LEVEL);
        }

        for (ptr_at, delta) in hits {
            // Build the new step list (`delta` is the offset added at this
            // level after dereference + tag-mask: A_(k+1) = (read_u64(A_k) &
            // !7) + delta). steps is in reverse order (deepest first).
            let mut new_steps = steps.clone();
            new_steps.push(delta);

            if let Some((module_name, module_offset)) = find_module(&ctx.modules, ptr_at) {
                // Reached a static anchor — record the chain in forward order.
                let mut forward_steps = new_steps.clone();
                forward_steps.reverse();
                results.push(ChainTemplate {
                    module: module_name,
                    module_offset,
                    steps: forward_steps,
                });
                if results.len() >= MAX_CHAINS_PER_DUMP {
                    return results;
                }
                continue;
            }

            // Otherwise recurse.
            if visited.insert(ptr_at, ()).is_some() {
                continue;
            }
            stack.push((ptr_at, new_steps));
        }
    }

    results
}

/// Find addresses A such that (read_u64(A) & !7) lands within [target -
/// disp, target + disp]. Returns (A, delta) where delta = target -
/// (read_u64(A) & !7), so the forward chain step at this level is `+delta`.
fn pointers_near(ctx: &DumpCtx, target: u64, disp: i64) -> Vec<(u64, i64)> {
    let mut out = Vec::new();
    for delta in -disp..=disp {
        // Skip non-aligned candidate values; we only indexed 8-aligned values.
        let candidate_val = (target as i64 - delta) as u64;
        if let Some(addrs) = ctx.pointer_index.get(&candidate_val) {
            for &a in addrs {
                out.push((a, delta));
            }
        }
    }
    out
}

fn find_module(modules: &[Module64], addr: u64) -> Option<(String, u64)> {
    for m in modules {
        if addr >= m.base && addr < m.base + m.size {
            return Some((m.name.clone(), addr - m.base));
        }
    }
    None
}

/// Forward-traverse a chain and return the resolved final address (or None
/// if any read fails or any pointer arithmetic over/underflows.
fn resolve_chain(ctx: &DumpCtx, t: &ChainTemplate) -> Option<u64> {
    let m = ctx.modules.iter().find(|m| m.name == t.module)?;
    let mut addr = m.base.checked_add(t.module_offset)?;
    for &step in &t.steps {
        let val = read_u64(ctx, addr)?;
        let masked = val & !7;
        addr = if step >= 0 {
            masked.checked_add(step as u64)?
        } else {
            masked.checked_sub(step.unsigned_abs())?
        };
    }
    Some(addr)
}

fn read_u64(ctx: &DumpCtx, addr: u64) -> Option<u64> {
    for region in &ctx.memory {
        let end = region.base.checked_add(region.bytes.len() as u64)?;
        let addr_end = addr.checked_add(8)?;
        if addr >= region.base && addr_end <= end {
            let off = (addr - region.base) as usize;
            // Defense-in-depth bounds re-check; the above guarantees this but
            // the cost is one branch per call.
            if off + 8 > region.bytes.len() {
                continue;
            }
            return Some(u64::from_le_bytes([
                region.bytes[off],
                region.bytes[off + 1],
                region.bytes[off + 2],
                region.bytes[off + 3],
                region.bytes[off + 4],
                region.bytes[off + 5],
                region.bytes[off + 6],
                region.bytes[off + 7],
            ]));
        }
    }
    None
}

fn print_chain_summary(sc: &ScoredChain, total: usize) {
    let confirmed = sc.confirmed_count();
    let steps_str = sc
        .template
        .steps
        .iter()
        .map(|s| format_signed_hex(*s))
        .collect::<Vec<_>>()
        .join(", ");
    println!(
        "  [{:>2}/{}] {}+0x{:x} -> [{}]",
        confirmed, total, sc.template.module, sc.template.module_offset, steps_str
    );
    for (label, res) in &sc.resolutions {
        match res {
            Some(a) => println!("      {}: 0x{:016x} OK", label, a),
            None => println!("      {}: <unresolved>", label),
        }
    }
}

fn format_signed_hex(v: i64) -> String {
    if v >= 0 {
        format!("+0x{:x}", v)
    } else {
        format!("-0x{:x}", v.unsigned_abs())
    }
}

fn write_report(
    path: &Path,
    contexts: &[DumpCtx],
    scored: &[ScoredChain],
    total: usize,
) {
    let mut f = match fs::File::create(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Couldn't write report to {}: {}", path.display(), e);
            return;
        }
    };
    let _ = writeln!(f, "# PR-C2 Pointer-Scan Report\n");
    let _ = writeln!(f, "Dumps analyzed:");
    for ctx in contexts {
        let _ = writeln!(
            f,
            "- `{}` (heap_prefix={:?}, {} player targets, {} memory regions, {:.0} MB)",
            ctx.label,
            ctx.heap_prefix,
            ctx.targets.len(),
            ctx.memory.len(),
            ctx.memory.iter().map(|r| r.bytes.len()).sum::<usize>() as f64 / 1048576.0
        );
    }
    let _ = writeln!(f);

    let mut buckets: HashMap<usize, usize> = HashMap::new();
    for sc in scored {
        *buckets.entry(sc.confirmed_count()).or_default() += 1;
    }
    let mut bks: Vec<(usize, usize)> = buckets.into_iter().collect();
    bks.sort_by(|a, b| b.0.cmp(&a.0));
    let _ = writeln!(f, "## Stability distribution\n");
    let _ = writeln!(f, "| Confirmed dumps | Chain count |");
    let _ = writeln!(f, "|---|---|");
    for (confirmed, count) in &bks {
        let _ = writeln!(f, "| {}/{} | {} |", confirmed, total, count);
    }
    let _ = writeln!(f);

    let _ = writeln!(f, "## Top 30 chains\n");
    for sc in scored.iter().take(30) {
        let confirmed = sc.confirmed_count();
        let _ = writeln!(
            f,
            "### {}/{}: `{} + 0x{:x}` ({} steps)",
            confirmed, total, sc.template.module, sc.template.module_offset, sc.template.steps.len()
        );
        let _ = writeln!(
            f,
            "Steps: `[{}]`",
            sc.template
                .steps
                .iter()
                .map(|s| format_signed_hex(*s))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let _ = writeln!(f);
        let _ = writeln!(f, "Resolutions:");
        for (label, res) in &sc.resolutions {
            match res {
                Some(a) => {
                    let _ = writeln!(f, "- `{}`: 0x{:016x}", label, a);
                }
                None => {
                    let _ = writeln!(f, "- `{}`: unresolved", label);
                }
            }
        }
        let _ = writeln!(f);
    }

    // Suppress unused-field warnings for fields that exist for future use.
    for ctx in contexts {
        let _ = ctx.txt_path.display();
    }
}
