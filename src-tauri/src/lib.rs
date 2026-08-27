#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::Mutex;
use tauri::{DragDropEvent, Emitter, WindowEvent};

/// 全局状态：最近打开的目录
struct AppState {
    last_dir: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            last_dir: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(drag_drop) = event {
                match drag_drop {
                    DragDropEvent::Enter { paths, .. } => {
                        let has_md = paths.iter().any(|p| {
                            p.to_string_lossy().ends_with(".md")
                                || p.to_string_lossy().ends_with(".markdown")
                                || p.to_string_lossy().ends_with(".txt")
                        });
                        let _ = window.emit("file-drop-hover", has_md);
                    }
                    DragDropEvent::Drop { paths, position: _ } => {
                        let files: Vec<String> = paths
                            .iter()
                            .filter(|p| {
                                let s = p.to_string_lossy();
                                s.ends_with(".md") || s.ends_with(".markdown") || s.ends_with(".txt")
                            })
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        let _ = window.emit("file-drop", files);
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::list_dir,
            commands::file_exists,
            commands::get_default_dir,
            commands::open_file_dialog,
            commands::save_file_dialog,
            commands::set_window_title,
            commands::pick_directory,
            commands::search_in_dir,
            commands::save_image,
            commands::git_status,
            commands::git_add,
            commands::git_commit,
            commands::git_push,
            commands::git_branch,
            commands::git_log,
            commands::scan_links,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
