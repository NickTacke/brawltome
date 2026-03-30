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
    VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT,
    PAGE_GUARD, PAGE_NOACCESS,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};

#[derive(Clone)]
pub struct MemoryRegion {
    pub base: usize,
    pub size: usize,
}

/// Cached region set with auto-detected heap prefix filtering.
/// Mirrors Python's RegionCache: after the first scan, only regions whose
/// top-32-bit prefix matches the game heap are scanned.
pub struct RegionCache {
    pub regions: Vec<MemoryRegion>,
    pub heap_prefix: Option<u32>,
    /// Separate prefix for player/atom data (may differ from BhID heap prefix).
    pub atom_prefix: Option<u32>,
}

impl RegionCache {
    pub fn new(regions: Vec<MemoryRegion>) -> Self {
        Self { regions, heap_prefix: None, atom_prefix: None }
    }

    /// Return regions filtered to the heap prefix (if known).
    pub fn heap_regions(&self) -> Vec<&MemoryRegion> {
        match self.heap_prefix {
            Some(prefix) => self.regions.iter()
                .filter(|r| (r.base >> 32) as u32 == prefix)
                .collect(),
            None => self.regions.iter().collect(),
        }
    }

    /// Return regions filtered to the atom prefix (if known), otherwise all regions.
    pub fn atom_regions(&self) -> Vec<&MemoryRegion> {
        match self.atom_prefix {
            Some(prefix) => self.regions.iter()
                .filter(|r| (r.base >> 32) as u32 == prefix)
                .collect(),
            None => self.regions.iter().collect(),
        }
    }

    /// Return atom regions split into (small, large) by a size threshold.
    /// Small regions are scanned first for faster player detection.
    pub fn atom_regions_split(&self, threshold: usize) -> (Vec<MemoryRegion>, Vec<MemoryRegion>) {
        let all = self.atom_regions();
        let small: Vec<MemoryRegion> = all.iter().filter(|r| r.size < threshold).map(|r| (*r).clone()).collect();
        let large: Vec<MemoryRegion> = all.iter().filter(|r| r.size >= threshold).map(|r| (*r).clone()).collect();
        (small, large)
    }

    /// Learn atom prefix from scan results (separate from heap prefix).
    pub fn learn_atom_prefix(&mut self, addrs: &[usize]) {
        if self.atom_prefix.is_some() || addrs.is_empty() {
            return;
        }
        let mut counts: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
        for &a in addrs {
            *counts.entry((a >> 32) as u32).or_default() += 1;
        }
        if let Some((&prefix, _)) = counts.iter().max_by_key(|(_, &c)| c) {
            let total: usize = self.regions.iter()
                .filter(|r| (r.base >> 32) as u32 == prefix)
                .map(|r| r.size)
                .sum();
            log::info!(
                "Atom prefix detected: 0x{:08X} ({:.1} MB)",
                prefix, total as f64 / 1048576.0
            );
            self.atom_prefix = Some(prefix);
        }
    }

    /// Auto-detect heap prefix from a set of found addresses.
    pub fn learn_prefix(&mut self, addrs: &[usize]) {
        if self.heap_prefix.is_some() || addrs.is_empty() {
            return;
        }
        let mut counts: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
        for &a in addrs {
            *counts.entry((a >> 32) as u32).or_default() += 1;
        }
        if let Some((&prefix, _)) = counts.iter().max_by_key(|(_, &c)| c) {
            let total: usize = self.regions.iter().map(|r| r.size).sum();
            let heap_total: usize = self.regions.iter()
                .filter(|r| (r.base >> 32) as u32 == prefix)
                .map(|r| r.size)
                .sum();
            log::info!(
                "Heap prefix detected: 0x{:08X} ({:.1} MB / {:.1} MB total)",
                prefix, heap_total as f64 / 1048576.0, total as f64 / 1048576.0
            );
            self.heap_prefix = Some(prefix);
        }
    }
}

/// Scan only the heap-filtered regions for a pattern.
pub fn scan_heap(
    handle: HANDLE,
    cache: &RegionCache,
    pattern: &[u8],
) -> Vec<usize> {
    let regions: Vec<MemoryRegion> = cache.heap_regions().into_iter().cloned().collect();
    scan_regions_with_buf(handle, &regions, pattern, &mut Vec::new())
}

/// Scan atom-filtered regions (uses atom_prefix if known, otherwise all regions).
pub fn scan_atom_regions(
    handle: HANDLE,
    cache: &RegionCache,
    pattern: &[u8],
) -> Vec<usize> {
    let regions: Vec<MemoryRegion> = cache.atom_regions().into_iter().cloned().collect();
    scan_regions_with_buf(handle, &regions, pattern, &mut Vec::new())
}


/// Find a process ID by executable name (e.g., "Brawlhalla.exe").
pub fn find_process_id(name: &str) -> Option<u32> {
    let _wide_name: Vec<u16> = OsStr::new(name).encode_wide().chain(std::iter::once(0)).collect();
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
    if handle == std::ptr::null_mut() { None } else { Some(handle) }
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

/// Collect committed readable regions from the target process.
/// No Type filter (includes MEM_IMAGE like the Python memutil.py).
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

        let base = mbi.BaseAddress as usize;
        let size = mbi.RegionSize;

        // Match Python: MEM_COMMIT + readable protection, no Type filter
        if mbi.State == MEM_COMMIT
            && size < 100_000_000
            && (mbi.Protect & PAGE_GUARD) == 0
            && mbi.Protect != PAGE_NOACCESS
        {
            regions.push(MemoryRegion { base, size });
        }

        let next = base + size;
        if next <= addr || next > 0x7FFFFFFFFFFF {
            break;
        }
        addr = next;
    }
    regions
}

/// Returns total bytes across all regions.
pub fn region_stats(regions: &[MemoryRegion]) -> usize {
    regions.iter().map(|r| r.size).sum()
}

/// Number of threads for parallel scanning.
const SCAN_THREADS: usize = 8;

/// Scan regions for a byte pattern using SIMD-accelerated memmem.
/// Regions are distributed across threads by total byte count (not region count)
/// so work is balanced even when region sizes vary wildly.
pub fn scan_regions_with_buf(
    handle: HANDLE,
    regions: &[MemoryRegion],
    pattern: &[u8],
    _buf: &mut Vec<u8>,
) -> Vec<usize> {
    if regions.is_empty() {
        return Vec::new();
    }

    let finder = memchr::memmem::Finder::new(pattern);
    let handle_val = handle as usize;

    // Distribute regions across threads by cumulative byte size
    let total_bytes: usize = regions.iter().map(|r| r.size).sum();
    let bytes_per_thread = (total_bytes / SCAN_THREADS).max(1);
    let mut chunks: Vec<&[MemoryRegion]> = Vec::with_capacity(SCAN_THREADS);
    let mut start = 0;
    let mut running = 0usize;
    for (i, r) in regions.iter().enumerate() {
        running += r.size;
        if running >= bytes_per_thread && chunks.len() < SCAN_THREADS - 1 {
            chunks.push(&regions[start..=i]);
            start = i + 1;
            running = 0;
        }
    }
    if start < regions.len() {
        chunks.push(&regions[start..]);
    }

    let results: Vec<Vec<usize>> = std::thread::scope(|s| {
        chunks.iter()
            .map(|chunk| {
                let finder = &finder;
                s.spawn(move || {
                    let handle = handle_val as HANDLE;
                    let mut buf = Vec::new();
                    let mut local = Vec::new();
                    for r in *chunk {
                        if r.size > buf.len() {
                            buf.resize(r.size, 0);
                        }
                        let mut bytes_read = 0usize;
                        let ok = unsafe {
                            ReadProcessMemory(
                                handle,
                                r.base as *const _,
                                buf.as_mut_ptr() as *mut _,
                                r.size,
                                &mut bytes_read,
                            )
                        };
                        if ok == 0 {
                            continue;
                        }
                        let data = &buf[..bytes_read];
                        for idx in finder.find_iter(data) {
                            local.push(r.base + idx);
                        }
                    }
                    local
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    });

    results.into_iter().flatten().collect()
}

/// Scan regions for a byte pattern, returning matching addresses.
pub fn scan_regions(
    handle: HANDLE,
    regions: &[MemoryRegion],
    pattern: &[u8],
) -> Vec<usize> {
    let mut buf = Vec::new();
    scan_regions_with_buf(handle, regions, pattern, &mut buf)
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
    if handle != std::ptr::null_mut() && handle != INVALID_HANDLE {
        unsafe { CloseHandle(handle) };
    }
}
