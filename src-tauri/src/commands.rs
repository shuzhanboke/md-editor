use std::fs;
use std::path::Path;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::AppState;

/// 读取文件内容（UTF-8）
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 写入文件内容（UTF-8）
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 列出目录下的条目
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let read = fs::read_dir(&path).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in read {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let file_type = entry.file_type();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = file_type.map(|t| t.is_dir()).unwrap_or(false);
        let entry_path = entry.path().to_string_lossy().to_string();
        entries.push(DirEntry {
            name,
            path: entry_path,
            is_dir,
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[derive(serde::Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 检查文件是否存在
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 获取默认工作目录
#[tauri::command]
pub fn get_default_dir(state: State<'_, AppState>) -> String {
    if let Ok(last) = state.last_dir.lock() {
        if let Some(d) = last.as_ref() {
            return d.clone();
        }
    }
    if let Some(doc_dir) = dirs_next() {
        return doc_dir;
    }
    "C:".to_string()
}

fn dirs_next() -> Option<String> {
    use std::env;
    match env::var("USERPROFILE") {
        Ok(home) => {
            let docs = format!("{}\\Documents", home);
            if Path::new(&docs).exists() {
                Some(docs)
            } else {
                Some(home)
            }
        }
        Err(_) => env::var("HOMEPATH").ok(),
    }
}

/// 弹出打开文件对话框，返回选中路径
#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .pick_file(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });
    rx.recv()
        .map_err(|e| format!("对话框错误: {}", e))
}

/// 弹出保存文件对话框，返回选中路径
#[tauri::command]
pub async fn save_file_dialog(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file().add_filter("Markdown", &["md", "markdown", "txt"]);
    if let Some(name) = default_name {
        builder = builder.set_file_name(name);
    }
    builder.save_file(move |path| {
        let result = path.map(|p| p.to_string());
        let _ = tx.send(result);
    });
    rx.recv()
        .map_err(|e| format!("对话框错误: {}", e))
}

/// 设置窗口标题
#[tauri::command]
pub fn set_window_title(app: tauri::AppHandle, title: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_title(&title)
            .map_err(|e| format!("设置标题失败: {}", e))?;
    }
    Ok(())
}

/// 弹出文件夹选择对话框，返回选中目录路径
#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |path| {
            let result = path.map(|p| p.to_string());
            let _ = tx.send(result);
        });
    rx.recv()
        .map_err(|e| format!("对话框错误: {}", e))
}
