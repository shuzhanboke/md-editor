// Tauri 后端 API 桥接层
// Tauri 2 通过全局 __TAURI__ 对象提供 API，无需 npm 包

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

function getInvoke() {
  if (typeof window === "undefined") return null;
  if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
    return window.__TAURI_INTERNALS__.invoke;
  }
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    return window.__TAURI__.core.invoke;
  }
  return null;
}

const invoke = getInvoke();

export const env = { isTauri };

/** 调用 Rust 命令 */
async function cmd(name, args = {}) {
  if (!isTauri || !invoke) {
    throw new Error(`非 Tauri 环境，无法调用命令: ${name}`);
  }
  return invoke(name, args);
}

/** 读取文件内容 */
export async function readFile(path) {
  return cmd("read_file", { path });
}

/** 写入文件内容 */
export async function writeFile(path, content) {
  return cmd("write_file", { path, content });
}

/** 列出目录 */
export async function listDir(path) {
  return cmd("list_dir", { path });
}

/** 文件是否存在 */
export async function fileExists(path) {
  return cmd("file_exists", { path });
}

/** 获取默认目录 */
export async function getDefaultDir() {
  return cmd("get_default_dir");
}

/** 打开文件对话框 */
export async function openFile() {
  if (!isTauri) return null;
  return cmd("open_file_dialog");
}

/** 保存文件对话框 */
export async function saveFile(defaultName = "未命名.md") {
  if (!isTauri) return null;
  return cmd("save_file_dialog", { defaultName });
}

/** 选择文件夹（工作区目录），返回选中目录路径 */
export async function pickDirectory() {
  if (!isTauri) return null;
  return cmd("pick_directory");
}

/** 在工作区目录递归搜索内容，返回匹配结果 */
export async function searchInDir(dir, query, useRegex = false) {
  if (!isTauri) return [];
  return cmd("search_in_dir", { dir, query, useRegex });
}

/** 保存图片到指定目录的 assets 子目录，返回相对路径 */
export async function saveImage(baseDir, fileName, data) {
  if (!isTauri) return null;
  return cmd("save_image", { baseDir, fileName, data });
}

// ============ Git 集成 ============
export async function gitStatus(dir) { return cmd("git_status", { dir }); }
export async function gitAdd(dir, paths) { return cmd("git_add", { dir, paths }); }
export async function gitCommit(dir, message) { return cmd("git_commit", { dir, message }); }
export async function gitPush(dir) { return cmd("git_push", { dir }); }
export async function gitBranch(dir) { return cmd("git_branch", { dir }); }
export async function gitLog(dir, count) { return cmd("git_log", { dir, count }); }

/** 扫描文档关系图谱（双向链接 [[]]） */
export async function scanLinks(dir) { return cmd("scan_links", { dir }); }

/** 设置窗口标题 */
export async function setWindowTitle(title) {
  if (!isTauri) return;
  return cmd("set_window_title", { title });
}

/** 监听文件拖拽事件（Tauri 后端 emit） */
export function onFileDrop(callback) {
  if (!isTauri) return () => {};
  const unlisten = window.__TAURI_INTERNALS__?.invoke
    ? import("@tauri-apps/api/event").then((m) => m.listen("file-drop", (e) => callback(e.payload)))
    : Promise.resolve(() => {});
  let off = () => {};
  unlisten.then((fn) => (off = fn));
  return () => off();
}

/** 读取文件并打开为标签 */
export async function readAndOpen(path, name, app) {
  const content = await readFile(path);
  app.newTab(content, name, path);
}
