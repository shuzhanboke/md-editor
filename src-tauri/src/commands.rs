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

/// 递归在工作区目录内搜索包含关键字的文件，返回匹配结果
#[tauri::command]
pub fn search_in_dir(
    dir: String,
    query: String,
    use_regex: Option<bool>,
) -> Result<Vec<SearchHit>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let use_re = use_regex.unwrap_or(false);
    let re = if use_re {
        Some(regex::Regex::new(query).map_err(|e| format!("正则错误: {}", e))?)
    } else {
        None
    };
    let mut hits = Vec::new();
    search_recursive(&dir, query, re.as_ref(), &mut hits, 0)?;
    // 限制结果数量
    hits.truncate(200);
    Ok(hits)
}

#[derive(serde::Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub text: String,
}

fn search_recursive(
    dir: &str,
    query: &str,
    re: Option<&regex::Regex>,
    hits: &mut Vec<SearchHit>,
    depth: usize,
) -> Result<(), String> {
    if depth > 5 || hits.len() >= 200 {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("node_modules") || name.eq_ignore_ascii_case("target") {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type();
        let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            search_recursive(path.to_str().unwrap_or(""), query, re, hits, depth + 1)?;
        } else if is_md_file(&name) {
            if let Ok(content) = fs::read_to_string(&path) {
                let lq = query.to_lowercase();
                for (i, line) in content.lines().enumerate() {
                    let matched = match re {
                        Some(r) => r.is_match(line),
                        None => line.to_lowercase().contains(&lq),
                    };
                    if matched {
                        hits.push(SearchHit {
                            path: path.to_string_lossy().to_string(),
                            name: name.clone(),
                            line: i + 1,
                            text: line.chars().take(200).collect(),
                        });
                        if hits.len() >= 200 {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn is_md_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")
}

/// 保存图片到指定目录，返回保存后的相对路径
#[tauri::command]
pub fn save_image(
    base_dir: String,
    file_name: String,
    data: Vec<u8>,
) -> Result<String, String> {
    let assets_dir = format!("{}/assets", base_dir.trim_end_matches(['/', '\\']));
    fs::create_dir_all(&assets_dir).map_err(|e| format!("创建 assets 目录失败: {}", e))?;
    let path = format!("{}/{}", assets_dir, file_name);
    fs::write(&path, &data).map_err(|e| format!("保存图片失败: {}", e))?;
    Ok(format!("assets/{}", file_name))
}

// ============ Git 集成 ============

/// 获取工作区 git 状态，返回文件变更列表
#[tauri::command]
pub fn git_status(dir: String) -> Result<Vec<GitFileStatus>, String> {
    let output = run_git(&dir, &["status", "--porcelain=v1"])?;
    let mut files = Vec::new();
    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let status = &line[..2];
        let path = line[3..].trim().to_string();
        let kind = if status.contains('?') {
            "untracked".to_string()
        } else if status.contains('M') {
            "modified".to_string()
        } else if status.contains('A') {
            "added".to_string()
        } else if status.contains('D') {
            "deleted".to_string()
        } else {
            "changed".to_string()
        };
        files.push(GitFileStatus { path, status: kind });
    }
    Ok(files)
}

#[derive(serde::Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

/// git add（暂存文件）
#[tauri::command]
pub fn git_add(dir: String, paths: Vec<String>) -> Result<(), String> {
    let mut args: Vec<&str> = vec!["add"];
    let owned: Vec<String> = paths;
    let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    args.extend(refs);
    run_git(&dir, &args)?;
    Ok(())
}

/// git commit
#[tauri::command]
pub fn git_commit(dir: String, message: String) -> Result<String, String> {
    let output = run_git(&dir, &["commit", "-m", &message])?;
    Ok(output)
}

/// git push
#[tauri::command]
pub fn git_push(dir: String) -> Result<String, String> {
    let output = run_git(&dir, &["push"])?;
    Ok(output)
}

/// 当前分支名
#[tauri::command]
pub fn git_branch(dir: String) -> Result<String, String> {
    let output = run_git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(output.trim().to_string())
}

/// 最近提交历史
#[tauri::command]
pub fn git_log(dir: String, count: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let n = count.unwrap_or(20).to_string();
    let output = run_git(&dir, &["log", &format!("--pretty=format:%H|%an|%ad|%s"), &format!("-{}", n)])?;
    let mut commits = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() == 4 {
            commits.push(GitCommit {
                hash: parts[0].to_string(),
                author: parts[1].to_string(),
                date: parts[2].to_string(),
                message: parts[3].to_string(),
            });
        }
    }
    Ok(commits)
}

#[derive(serde::Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

fn run_git(dir: &str, args: &[&str]) -> Result<String, String> {
    use std::process::Command;
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("执行 git 失败: {}", e))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git 错误: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ============ 文档关系图谱 ============

/// 扫描工作区所有 md 文件的双向链接 [[]]，返回节点与边
#[tauri::command]
pub fn scan_links(dir: String) -> Result<GraphData, String> {
    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    collect_md_files(&dir, &mut files, 0)?;
    for path in &files {
        let name = Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        nodes.push(GraphNode { id: name.clone(), path: path.clone() });
    }
    // 扫描每个文件的 [[link]]
    for node in &nodes {
        if let Ok(content) = fs::read_to_string(&node.path) {
            let re = regex::Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
            for cap in re.captures_iter(&content) {
                let target = cap.get(1).unwrap().as_str().trim().to_string();
                let target_stem = target.split('|').next().unwrap_or(&target).trim().to_string();
                // 只在工作区内匹配
                if nodes.iter().any(|n| n.id == target_stem) {
                    edges.push(GraphEdge {
                        source: node.id.clone(),
                        target: target_stem,
                    });
                }
            }
        }
    }
    Ok(GraphData { nodes, edges })
}

fn collect_md_files(dir: &str, files: &mut Vec<String>, depth: usize) -> Result<(), String> {
    if depth > 6 {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name.eq_ignore_ascii_case("node_modules") || name.eq_ignore_ascii_case("target") {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type();
        let is_dir = ft.map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            collect_md_files(path.to_str().unwrap_or(""), files, depth + 1)?;
        } else if is_md_file(&name) {
            files.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(serde::Serialize)]
pub struct GraphNode {
    pub id: String,
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}
