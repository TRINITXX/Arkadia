// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // First, while no thread exists: never pass a launching Claude session's
    // markers on to our terminals (they would save no transcript).
    arkadia_lib::forget_parent_claude_session();
    // The phone companion's always-on gate: same exe, no window (see `gate`).
    if arkadia_lib::gate::is_gate_mode() {
        return arkadia_lib::gate::run();
    }
    arkadia_lib::run()
}
