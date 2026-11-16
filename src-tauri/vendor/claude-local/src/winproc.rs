//! Windows 进程工具：枚举进程、读命令行、按 PID 关窗 / 结束、查进程身份。
//! 与 Codex++ 的 windows_integration 同一实现（只取本库用到的部分）。
#![allow(clippy::all)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;

use anyhow::Context;
use windows::Win32::Foundation::{BOOL, CloseHandle, FILETIME, HANDLE, HWND, LPARAM, MAX_PATH, WPARAM};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_TERMINATE, PROCESS_VM_READ, QueryFullProcessImageNameW, TerminateProcess,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GetClassNameW, GetWindowLongPtrW, GetWindowTextLengthW,
    GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE, WS_EX_APPWINDOW,
    WS_EX_TOOLWINDOW,
};
use windows::core::PWSTR;

/// 请求归属 `process_id` 的可见主窗口关闭（`WM_CLOSE`）。
///
/// 为什么需要它：Windows 上没有 AppleEvent `quit` 的等价物，而
/// `taskkill /T`（不带 `/F`）对 GUI 应用**不生效**——本机 Windows 11 实测 11 个
/// ChatGPT 进程一个都没退，静默失败比报错更糟。`/F` 则是 `TerminateProcess`，
/// 不给应用保存机会。`WM_CLOSE` 才是「像用户点关闭按钮一样」的路径：
/// Electron 能走完 `before-quit` / `will-quit`，把内存态落盘。
///
/// 返回是否成功投递。投递成功不等于应用会退出，调用方仍需轮询确认。
#[cfg(windows)]
pub fn request_process_close(process_id: u32) -> bool {
    let Some(hwnd) = visible_window_for_process(process_id) else {
        return false;
    };
    // SAFETY: hwnd 来自 EnumWindows 且已确认属于该进程；WM_CLOSE 无附加参数。
    unsafe { PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0)) }.is_ok()
}


/// 结束一个进程树。
///
/// `force = false` 时**只**走 `WM_CLOSE`（不调用 taskkill）：`taskkill /T` 对 GUI
/// 应用无效，混在一起只会让「优雅退出」变成静默失败。`force = true` 才用
/// `taskkill /F /T` 兜底。
#[cfg(windows)]
pub fn close_process_tree(process_id: u32, force: bool) -> bool {
    if !force {
        return request_process_close(process_id);
    }
    use std::os::windows::process::CommandExt;
    // taskkill 是控制台程序，不加 CREATE_NO_WINDOW 会从 GUI 进程里闪出黑色终端。
    let output = std::process::Command::new("taskkill")
        .args(["/PID", process_id.to_string().as_str(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    matches!(output, Ok(output) if output.status.success())
}


#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;


#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsProcessInfo {
    pub process_id: u32,
    pub parent_process_id: u32,
    pub exe_file: String,
    pub executable_path: Option<PathBuf>,
}


#[cfg(windows)]
pub fn enumerate_processes() -> Vec<WindowsProcessInfo> {
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return Vec::new();
    };
    if snapshot.is_invalid() {
        return Vec::new();
    }
    let _guard = HandleGuard(snapshot);
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_err() {
        return Vec::new();
    }
    loop {
        let process_id = entry.th32ProcessID;
        processes.push(WindowsProcessInfo {
            process_id,
            parent_process_id: entry.th32ParentProcessID,
            exe_file: nul_terminated_wide_to_string(&entry.szExeFile),
            executable_path: query_process_image_path(process_id),
        });
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
            break;
        }
    }
    processes
}


#[cfg(windows)]
pub fn terminate_process(process_id: u32) -> bool {
    let Ok(handle) = (unsafe {
        OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
    }) else {
        return false;
    };
    if handle.is_invalid() {
        return false;
    }
    let _guard = HandleGuard(handle);
    unsafe { TerminateProcess(handle, 0) }.is_ok()
}


#[cfg(windows)]
pub(crate) fn process_lifetime(process_id: u32) -> anyhow::Result<Option<(u64, bool)>> {
    process_lifetime_with(process_id, |access, pid| unsafe {
        OpenProcess(access, false, pid)
    })
}


#[cfg(windows)]
fn process_lifetime_with(
    process_id: u32,
    open: impl FnOnce(
        windows::Win32::System::Threading::PROCESS_ACCESS_RIGHTS,
        u32,
    ) -> windows::core::Result<HANDLE>,
) -> anyhow::Result<Option<(u64, bool)>> {
    let handle = match open(PROCESS_QUERY_LIMITED_INFORMATION, process_id) {
        Ok(handle) => handle,
        Err(error) if error.code().0 as u32 == 0x80070057 => return Ok(None),
        Err(error) => {
            return Err(std::io::Error::from_raw_os_error(error.code().0 & 0xffff))
                .context("无法查询进程创建身份");
        }
    };
    let _guard = HandleGuard(handle);
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) }
        .map_err(|error| std::io::Error::from_raw_os_error(error.code().0 & 0xffff))
        .context("无法读取进程创建身份")?;
    let birth = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    anyhow::ensure!(birth != 0, "进程创建身份无效");
    let mut exit_code = 0_u32;
    unsafe { GetExitCodeProcess(handle, &mut exit_code) }
        .map_err(|error| std::io::Error::from_raw_os_error(error.code().0 & 0xffff))
        .context("无法确认进程退出状态")?;
    Ok(Some((birth, exit_code != 259)))
}


/// 读取指定进程的完整命令行。
///
/// Toolhelp 快照只有 exe 名，命令行得走 PEB（`NtQueryInformationProcess` +
/// `ReadProcessMemory`）。Windows 上多开实例各自带 `--remote-debugging-port=<port>`，
/// 命令行是区分实例的唯一依据。读不到（权限不足、进程已退出、布局不符）就返回
/// `None`，由调用方决定漏判策略——这里绝不猜。
#[cfg(windows)]
pub fn process_command_line(process_id: u32) -> Option<String> {
    if process_id == 0 {
        return None;
    }
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
            false,
            process_id,
        )
    }
    .ok()?;
    if handle.is_invalid() {
        return None;
    }
    let _guard = HandleGuard(handle);
    process_command_line_from_handle(handle)
}


#[cfg(windows)]
fn process_command_line_from_handle(handle: HANDLE) -> Option<String> {
    let peb = query_peb_base_address(handle)?;
    // 先按 x64 / ARM64 布局读；32 位（WOW64）进程再退回 32 位布局重试一次。
    if let Some(command_line) = read_command_line_at(
        handle,
        peb,
        X64_PROCESS_PARAMETERS_OFFSET,
        X64_COMMAND_LINE_OFFSET,
        false,
    ) {
        return Some(command_line);
    }
    let peb32 = query_wow64_peb_address(handle)?;
    read_command_line_at(
        handle,
        peb32,
        X86_PROCESS_PARAMETERS_OFFSET,
        X86_COMMAND_LINE_OFFSET,
        true,
    )
}


/// `ProcessBasicInformation` / `ProcessWow64Information`。
#[cfg(windows)]
const PROCESS_BASIC_INFORMATION_CLASS: u32 = 0;

#[cfg(windows)]
const PROCESS_WOW64_INFORMATION_CLASS: u32 = 26;


/// PEB 与 `RTL_USER_PROCESS_PARAMETERS` 都是未公开布局，只能按位数写死偏移。
#[cfg(windows)]
const X64_PROCESS_PARAMETERS_OFFSET: usize = 0x20;

#[cfg(windows)]
const X64_COMMAND_LINE_OFFSET: usize = 0x70;

#[cfg(windows)]
const X86_PROCESS_PARAMETERS_OFFSET: usize = 0x10;

#[cfg(windows)]
const X86_COMMAND_LINE_OFFSET: usize = 0x40;


/// Windows 命令行上限 32767 个字符；`UNICODE_STRING.length` 是字节数。
#[cfg(windows)]
const MAX_COMMAND_LINE_BYTES: usize = 32 * 1024;


/// `PROCESS_BASIC_INFORMATION`。windows crate 里那份定义需要 `Win32_System_Kernel`
/// feature，而这里只用到 `peb_base_address`，不值得为它扩大 feature 面。
#[cfg(windows)]
#[repr(C)]
#[allow(dead_code)]
struct ProcessBasicInformation {
    exit_status: i32,
    peb_base_address: *mut core::ffi::c_void,
    affinity_mask: usize,
    base_priority: i32,
    unique_process_id: usize,
    inherited_from_unique_process_id: usize,
}


/// 远程进程里的 `UNICODE_STRING`：两个长度字段都是字节数。
#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct RemoteUnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}


// `NtQueryInformationProcess` 没有出现在 windows crate 的导出里；按本文件 IP Helper
// 的既有做法直接声明 NT ABI，不为一项查询扩大 windows crate 的 feature 面。
#[cfg(windows)]
#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationProcess(
        process_handle: HANDLE,
        information_class: u32,
        information: *mut core::ffi::c_void,
        information_length: u32,
        return_length: *mut u32,
    ) -> i32;
}


#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn ProcessIdToSessionId(process_id: u32, session_id: *mut u32) -> BOOL;

    fn ReadProcessMemory(
        process_handle: HANDLE,
        base_address: *const core::ffi::c_void,
        buffer: *mut core::ffi::c_void,
        size: usize,
        bytes_read: *mut usize,
    ) -> i32;
}


#[cfg(windows)]
fn query_peb_base_address(handle: HANDLE) -> Option<usize> {
    let mut information: ProcessBasicInformation = unsafe { std::mem::zeroed() };
    let mut returned = 0_u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_BASIC_INFORMATION_CLASS,
            (&mut information as *mut ProcessBasicInformation).cast(),
            std::mem::size_of::<ProcessBasicInformation>() as u32,
            &mut returned,
        )
    };
    (status >= 0 && !information.peb_base_address.is_null())
        .then_some(information.peb_base_address as usize)
}


/// 32 位（WOW64）目标进程的 PEB 地址；不是 WOW64 进程时返回 `None`。
#[cfg(windows)]
fn query_wow64_peb_address(handle: HANDLE) -> Option<usize> {
    let mut peb32 = 0_usize;
    let mut returned = 0_u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_WOW64_INFORMATION_CLASS,
            (&mut peb32 as *mut usize).cast(),
            std::mem::size_of::<usize>() as u32,
            &mut returned,
        )
    };
    (status >= 0 && peb32 != 0).then_some(peb32)
}


#[cfg(windows)]
fn read_command_line_at(
    handle: HANDLE,
    peb: usize,
    parameters_offset: usize,
    command_line_offset: usize,
    pointer_is_32_bit: bool,
) -> Option<String> {
    let parameters_address = peb.checked_add(parameters_offset)?;
    let parameters = if pointer_is_32_bit {
        read_process_memory::<u32>(handle, parameters_address)? as usize
    } else {
        read_process_memory::<usize>(handle, parameters_address)?
    };
    if parameters == 0 {
        return None;
    }
    let command_line: RemoteUnicodeString =
        read_process_memory(handle, parameters.checked_add(command_line_offset)?)?;
    let length = command_line.length as usize;
    // 尺寸自检：长度是字节数、必须为偶数，且不超过其容量与 Windows 命令行上限。
    // 32 位布局误读到 64 位进程时，这里通常就能拦住。
    if length == 0
        || length % 2 != 0
        || length > MAX_COMMAND_LINE_BYTES
        || length > command_line.maximum_length as usize
    {
        return None;
    }
    let mut buffer = vec![0_u16; length / 2];
    let read = read_process_memory_bytes(
        handle,
        command_line.buffer as usize,
        buffer.as_mut_ptr().cast(),
        length,
    )?;
    if read != length {
        return None;
    }
    let command_line = String::from_utf16_lossy(&buffer);
    (!command_line.trim().is_empty()).then_some(command_line)
}


#[cfg(windows)]
fn read_process_memory<T: Copy>(handle: HANDLE, address: usize) -> Option<T> {
    let mut value = std::mem::MaybeUninit::<T>::uninit();
    let size = std::mem::size_of::<T>();
    let read = read_process_memory_bytes(handle, address, value.as_mut_ptr().cast(), size)?;
    (read == size).then(|| unsafe { value.assume_init() })
}


#[cfg(windows)]
fn read_process_memory_bytes(
    handle: HANDLE,
    address: usize,
    buffer: *mut core::ffi::c_void,
    size: usize,
) -> Option<usize> {
    if address == 0 || size == 0 {
        return None;
    }
    let mut bytes_read = 0_usize;
    let result = unsafe {
        ReadProcessMemory(
            handle,
            address as *const core::ffi::c_void,
            buffer,
            size,
            &mut bytes_read,
        )
    };
    (result != 0).then_some(bytes_read)
}


#[cfg(windows)]
fn query_process_image_path(process_id: u32) -> Option<PathBuf> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()? };
    if handle.is_invalid() {
        return None;
    }
    let _guard = HandleGuard(handle);
    process_image_path_from_handle(handle)
}


#[cfg(windows)]
fn process_image_path_from_handle(handle: HANDLE) -> Option<PathBuf> {
    let mut buffer = vec![0u16; MAX_PATH as usize * 4];
    let mut len = buffer.len() as u32;
    unsafe {
        QueryFullProcessImageNameW(
            handle,
            Default::default(),
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
        .ok()?;
    }
    Some(PathBuf::from(OsString::from_wide(&buffer[..len as usize])))
}


#[cfg(windows)]
fn visible_window_for_process(process_id: u32) -> Option<HWND> {
    process_window(process_id, true)
}


#[cfg(windows)]
fn process_window(process_id: u32, visible_only: bool) -> Option<HWND> {
    let mut state = ActivateWindowState {
        process_id,
        hwnd: HWND::default(),
        visible_only,
        score: ProcessWindowScore::None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(find_process_window_proc),
            LPARAM((&mut state as *mut ActivateWindowState) as isize),
        );
    }
    if state.hwnd.is_invalid() {
        None
    } else {
        Some(state.hwnd)
    }
}


#[cfg(windows)]
struct ActivateWindowState {
    process_id: u32,
    hwnd: HWND,
    visible_only: bool,
    score: ProcessWindowScore,
}


#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum ProcessWindowScore {
    None,
    Fallback,
    Titled,
    AppWindow,
    TauriWindow,
}


#[cfg(windows)]
unsafe extern "system" fn find_process_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam.0 as *mut ActivateWindowState) };
    if state.visible_only && !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    let mut window_process_id = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut window_process_id));
    }
    if window_process_id == state.process_id {
        let title_length = unsafe { GetWindowTextLengthW(hwnd) };
        let extended_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
        let mut class_name = [0u16; 256];
        let class_name_length = unsafe { GetClassNameW(hwnd, &mut class_name) }.max(0) as usize;
        let class_name = String::from_utf16_lossy(&class_name[..class_name_length]);
        let score = process_window_score(title_length > 0, extended_style, &class_name);
        if score > state.score {
            state.hwnd = hwnd;
            state.score = score;
        }
        if score == ProcessWindowScore::TauriWindow {
            return BOOL(0);
        }
    }
    BOOL(1)
}


#[cfg(windows)]
fn process_window_score(
    has_title: bool,
    extended_style: u32,
    class_name: &str,
) -> ProcessWindowScore {
    let is_app_window = extended_style & WS_EX_APPWINDOW.0 != 0;
    let is_tool_window = extended_style & WS_EX_TOOLWINDOW.0 != 0;
    if is_tool_window || is_auxiliary_window_class(class_name) {
        ProcessWindowScore::Fallback
    } else if class_name.eq_ignore_ascii_case("Tauri Window") {
        ProcessWindowScore::TauriWindow
    } else if is_app_window && !is_tool_window {
        ProcessWindowScore::AppWindow
    } else if has_title {
        ProcessWindowScore::Titled
    } else {
        ProcessWindowScore::Fallback
    }
}


#[cfg(windows)]
fn is_auxiliary_window_class(class_name: &str) -> bool {
    matches!(
        class_name.to_ascii_lowercase().as_str(),
        "ime" | "msctfime ui" | "tray_icon_app" | "tao thread event target"
    )
}


#[cfg(windows)]
fn nul_terminated_wide_to_string(value: &[u16]) -> String {
    let len = value.iter().position(|ch| *ch == 0).unwrap_or(value.len());
    OsString::from_wide(&value[..len])
        .to_string_lossy()
        .to_string()
}


#[cfg(windows)]
struct HandleGuard(HANDLE);


#[cfg(windows)]
impl Drop for HandleGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}
