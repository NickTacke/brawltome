//! The Win32 calls that read the totals windows keeps for the app's processes: cpu time and working set.

use std::mem;

use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_VM_READ,
};

use super::{process_tree, ProcessTreeSample};

/// filetime counts in 100 ns steps
const FILETIME_STEPS_PER_MS: u64 = 10_000;

/// the app and every process below it, such as the webview's; none when windows won't list the processes
pub fn sample_process_tree(at_ms: u64) -> Option<ProcessTreeSample> {
    let parent_by_pid = match list_parents() {
        Ok(parent_by_pid) => parent_by_pid,
        Err(error) => {
            log::warn!("{error}");
            return None;
        }
    };

    // SAFETY: GetCurrentProcessId takes nothing and cannot fail
    let own_pid = unsafe { GetCurrentProcessId() };
    let mut sample = ProcessTreeSample {
        at_ms,
        ..ProcessTreeSample::default()
    };

    // a process that exits between the listing and the read is left out; it can't be read any more
    for pid in process_tree(own_pid, &parent_by_pid) {
        let Some(process) = OwnedHandle::open(pid) else {
            continue;
        };

        if let Some(cpu_ms) = cpu_ms(&process) {
            sample.cpu_ms_by_pid.insert(pid, cpu_ms);
        }
        if let Some(working_set_bytes) = working_set_bytes(&process) {
            sample
                .working_set_bytes_by_pid
                .insert(pid, working_set_bytes);
        }
    }

    Some(sample)
}

/// every running process with its parent, as (pid, parent pid)
fn list_parents() -> Result<Vec<(u32, u32)>, String> {
    // SAFETY: CreateToolhelp32Snapshot only reads its arguments; failure is INVALID_HANDLE_VALUE, checked below
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("list the processes for the match usage: no snapshot".to_string());
    }

    let snapshot = OwnedHandle(snapshot);
    let mut entry = PROCESSENTRY32W {
        dwSize: mem::size_of::<PROCESSENTRY32W>() as u32,
        ..PROCESSENTRY32W::default()
    };
    let mut parent_by_pid = Vec::new();

    // SAFETY: the snapshot handle is open, and entry is a live PROCESSENTRY32W with dwSize set as the call requires
    let mut has_entry = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while has_entry {
        parent_by_pid.push((entry.th32ProcessID, entry.th32ParentProcessID));
        // SAFETY: as for Process32FirstW above
        has_entry = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }

    Ok(parent_by_pid)
}

/// kernel plus user time since the process started
fn cpu_ms(process: &OwnedHandle) -> Option<u64> {
    let mut creation_time = FILETIME::default();
    let mut exit_time = FILETIME::default();
    let mut kernel_time = FILETIME::default();
    let mut user_time = FILETIME::default();

    // SAFETY: the handle is open with query rights, and the four pointers are live FILETIMEs on this stack
    let succeeded = unsafe {
        GetProcessTimes(
            process.0,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    };
    if succeeded == 0 {
        return None;
    }

    let steps = filetime_steps(kernel_time) + filetime_steps(user_time);

    Some(steps / FILETIME_STEPS_PER_MS)
}

fn working_set_bytes(process: &OwnedHandle) -> Option<u64> {
    let size = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: size,
        ..PROCESS_MEMORY_COUNTERS::default()
    };

    // SAFETY: the handle is open with query and read rights, and counters is a live struct of the size passed
    let succeeded = unsafe { GetProcessMemoryInfo(process.0, &mut counters, size) };
    if succeeded == 0 {
        return None;
    }

    u64::try_from(counters.WorkingSetSize).ok()
}

fn filetime_steps(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

/// closes the handle when it goes out of scope, on every return path
struct OwnedHandle(HANDLE);

impl OwnedHandle {
    /// none for a process that exited or that the app may not read
    fn open(pid: u32) -> Option<Self> {
        // SAFETY: OpenProcess only reads its arguments; failure is a null handle, checked below
        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if handle.is_null() {
            return None;
        }

        Some(Self(handle))
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: the handle is open and owned here alone, so it is closed exactly once
        unsafe { CloseHandle(self.0) };
    }
}
