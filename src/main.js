// 主应用：标签页、文件操作、主题、侧边栏、大纲、快捷键
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { Editor } from "./editor.js";
import { parseMarkdown, extractInlineMath, restoreInlineMath } from "./markdown.js";
import { reinitMermaid } from "./postrender.js";
import * as api from "./api.js";

const WELCOME = `# 欢迎使用 MD 编辑器 👋

这是一款 **本地 Markdown 编辑器**，灵感来自 Typora。

## 主要特性

- 所见即所得的即时渲染
- 代码块语法高亮、表格、任务列表、引用块
- 数学公式（KaTeX）：行内 $E=mc^2$ 与块级
- Mermaid 流程图
- 多标签页、文件树侧边栏、大纲面板
- 浅色 / 暗色主题切换
- 导出 PDF / HTML

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 | Ctrl + N |
| 打开 | Ctrl + O |
| 保存 | Ctrl + S |
| 切换主题 | Ctrl + Shift + T |

## 代码示例

\`\`\`rust
fn main() {
    println!("Hello, Markdown!");
}
\`\`\`

## 数学公式

$$
\\int_0^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
$$

## 任务列表

- [x] 本地即时渲染
- [x] 语法高亮
- [ ] 更多主题

> 开始你的创作吧！
`;

class App {
  constructor() {
    this.tabs = []; // {id, path, name, content, dirty, editor}
    this.activeTabId = null;
    // 从 localStorage 恢复上次状态（侧边栏、大纲、主题）
    this.theme = localStorage.getItem("md-theme") || "light";
    this.sidebarCollapsed = localStorage.getItem("md-sidebar") !== "open";
    this.outlineCollapsed = localStorage.getItem("md-outline") !== "open";
    this.currentDir = localStorage.getItem("md-lastdir") || null;

    this.editorEl = document.getElementById("editor");
    this.editor = null;
    this.saveTimer = null;

    this._initEditor();
    this._bindUI();
    this._loadInitialContent();
  }

  _initEditor() {
    this.editor = new Editor(
      this.editorEl,
      (content, dirty) => this._onContentChange(content, dirty),
      (headings) => this._renderOutline(headings)
    );
  }

  _bindUI() {
    document.getElementById("btn-new").addEventListener("click", () => this.newTab());
    document.getElementById("btn-open").addEventListener("click", () => this.openFile());
    document.getElementById("btn-save").addEventListener("click", () => this.saveCurrent());
    document.getElementById("btn-export").addEventListener("click", () => this.exportCurrent());
    document.getElementById("btn-theme").addEventListener("click", () => this.toggleTheme());
    document.getElementById("btn-outline").addEventListener("click", () => this.toggleOutline());
    document.getElementById("btn-sidebar").addEventListener("click", () => this.toggleSidebar());

    // 全局快捷键
    document.addEventListener("keydown", (e) => this._onGlobalKey(e));

    // 文件拖拽打开（Tauri 后端 emit 的 file-drop 事件）
    api.onFileDrop(async (files) => {
      if (!files || !files.length) return;
      for (const f of files) {
        try {
          const content = await api.readFile(f);
          const name = f.split(/[\\\/]/).pop();
          this.newTab(content, name, f);
        } catch (e) {
          console.warn("拖拽打开失败:", e);
        }
      }
    });

    // 右键上下文菜单（复制为 HTML/纯文本/源码）
    this._initContextMenu();

    // 全局搜索面板事件
    document.getElementById("search-input").addEventListener("input", () => this.doSearch());
    document.getElementById("search-use-regex").addEventListener("change", () => this.doSearch());
    document.getElementById("search-close").addEventListener("click", () => {
      document.getElementById("search-panel").classList.add("hidden");
    });

    // 图片粘贴/拖拽到编辑器自动保存到 assets
    this._initImagePaste();

    // 自定义 CSS
    document.getElementById("btn-customcss").addEventListener("click", () => this.toggleCustomCss());
    document.getElementById("css-close").addEventListener("click", () => this.toggleCustomCss());
    document.getElementById("css-apply").addEventListener("click", () => this.applyCustomCss());
    document.getElementById("css-reset").addEventListener("click", () => this.resetCustomCss());
    // 启动时加载自定义 CSS
    this._loadCustomCss();
  }

  /** 切换自定义 CSS 弹窗 */
  toggleCustomCss() {
    const modal = document.getElementById("css-modal");
    modal.classList.toggle("hidden");
    if (!modal.classList.contains("hidden")) {
      document.getElementById("css-editor").value = localStorage.getItem("md-customcss") || "";
      setTimeout(() => document.getElementById("css-editor").focus(), 50);
    }
  }

  /** 应用自定义 CSS */
  applyCustomCss() {
    const css = document.getElementById("css-editor").value;
    localStorage.setItem("md-customcss", css);
    this._injectCustomCss(css);
    document.getElementById("css-modal").classList.add("hidden");
    this._toast("自定义 CSS 已应用");
  }

  /** 重置自定义 CSS */
  resetCustomCss() {
    localStorage.removeItem("md-customcss");
    this._injectCustomCss("");
    document.getElementById("css-editor").value = "";
    this._toast("已重置为默认样式");
  }

  /** 启动加载自定义 CSS */
  _loadCustomCss() {
    const css = localStorage.getItem("md-customcss");
    if (css) this._injectCustomCss(css);
  }

  /** 注入/更新自定义 CSS style 标签 */
  _injectCustomCss(css) {
    let el = document.getElementById("custom-css");
    if (!el) {
      el = document.createElement("style");
      el.id = "custom-css";
      document.head.appendChild(el);
    }
    el.textContent = css || "";
  }

  _initImagePaste() {
    const ed = document.getElementById("editor");
    // 粘贴图片
    ed.addEventListener("paste", (e) => this._handlePasteImage(e));
    // 拖拽图片
    ed.addEventListener("drop", (e) => this._handleDropImage(e));
    ed.addEventListener("dragover", (e) => e.preventDefault());
  }

  /** 粘贴处理：检测剪贴板图片或表格数据（Excel/CSV） */
  async _handlePasteImage(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    // 1. 优先处理图片
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await this._saveAndInsertImage(file);
          return;
        }
      }
    }
    // 2. 处理表格文本（Excel/Sheets 复制的，含 Tab 分隔的多行）
    const text = e.clipboardData?.getData("text/plain");
    if (text && this._looksLikeTable(text)) {
      const md = this._csvToMarkdownTable(text);
      if (md) {
        e.preventDefault();
        this.editor.insertAtCursor(md);
        this._toast("已转换为 Markdown 表格");
      }
    }
  }

  /** 判断文本是否像表格（多行多列 Tab 分隔） */
  _looksLikeTable(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return false;
    // 至少 2 行含 Tab 或逗号，且列数一致
    const cols = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")));
    if (cols.some((c) => c.length < 2)) return false;
    const first = cols[0].length;
    return cols.every((c) => c.length === first);
  }

  /** CSV/TSV 文本转 Markdown 表格 */
  _csvToMarkdownTable(text) {
    const lines = text.trim().split(/\r?\n/);
    const rows = lines.map((l) => (l.includes("\t") ? l.split("\t") : l.split(",")));
    if (rows.length < 2) return null;
    const cols = rows[0].length;
    const header = `| ${rows[0].map((c) => c.trim()).join(" | ")} |`;
    const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
    const body = rows.slice(1).map((r) => `| ${r.map((c) => c.trim()).join(" | ")} |`).join("\n");
    return `${header}\n${sep}\n${body}`;
  }

  /** 拖拽处理：检测图片文件 */
  async _handleDropImage(e) {
    if (!e.dataTransfer?.files) return;
    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) {
        e.preventDefault();
        await this._saveAndInsertImage(file);
      }
    }
  }

  /** 保存图片并插入 markdown 链接 */
  async _saveAndInsertImage(file) {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (!tab.path) {
      this._toast("请先保存文件再插入图片");
      return;
    }
    const baseDir = tab.path.replace(/[\\/][^\\/]+$/, "");
    const ext = (file.name.match(/\.\w+$/) || [".png"])[0];
    const fileName = `img-${Date.now()}${ext}`;
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      const relPath = await api.saveImage(baseDir, fileName, Array.from(data));
      if (relPath) {
        const md = `![${file.name || "图片"}](${relPath})`;
        this.editor.insertAtCursor(md);
        tab.dirty = true;
        document.getElementById("current-file-name").textContent = tab.name + " •";
        this._renderTabs();
        this._toast("图片已保存到 assets");
      }
    } catch (e) {
      alert("保存图片失败: " + e);
    }
  }

  _initContextMenu() {
    const menu = document.getElementById("ctx-menu");
    // 右键唤起
    document.addEventListener("contextmenu", (e) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      // 仅在编辑区内唤起
      const ed = document.getElementById("editor");
      if (!ed.contains(sel.anchorNode)) return;
      e.preventDefault();
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;
      menu.classList.remove("hidden");
    });
    // 点击菜单项
    menu.addEventListener("click", (e) => {
      const item = e.target.closest(".ctx-item");
      if (!item) return;
      const action = item.dataset.action;
      menu.classList.add("hidden");
      this._doCopy(action);
    });
    // 点别处关闭
    document.addEventListener("click", () => menu.classList.add("hidden"));
  }

  /** 根据选中内容执行复制 */
  async _doCopy(action) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const text = sel.toString();
    if (!text.trim()) return;

    if (action === "copy-text") {
      await this._copyToClipboard(text, text);
      this._toast("已复制纯文本");
      return;
    }

    // 提取选中范围的 HTML
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    const html = container.innerHTML;

    if (action === "copy-html") {
      await this._copyToClipboard(html, text);
      this._toast("已复制 HTML");
    } else if (action === "copy-md") {
      // 从源码中找选中文本对应的 markdown（简化：直接复制选中文本，标称源码）
      await this._copyToClipboard(text, text);
      this._toast("已复制 Markdown 源码");
    }
  }

  /** 写入剪贴板（富文本 + 纯文本 fallback） */
  async _copyToClipboard(htmlOrText, plainText) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([htmlOrText], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
    } catch {
      // 回退 execCommand
      const ta = document.createElement("textarea");
      ta.value = plainText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }

  /** 轻量提示 */
  _toast(msg) {
    const info = document.getElementById("status-info");
    const old = info.textContent;
    info.textContent = msg;
    setTimeout(() => { info.textContent = old; }, 1500);
  }

  _loadInitialContent() {
    // 启动时创建一个欢迎标签
    this.newTab(WELCOME, "欢迎.md");
    this._initSidebar();
    this._syncInitialUI();
  }

  _syncInitialUI() {
    document.getElementById("sidebar").classList.toggle("collapsed", this.sidebarCollapsed);
    document.getElementById("outline").classList.toggle("collapsed", this.outlineCollapsed);
    // 应用主题
    const light = document.getElementById("theme-light");
    const dark = document.getElementById("theme-dark");
    light.disabled = this.theme === "dark";
    dark.disabled = this.theme !== "dark";
    document.documentElement.setAttribute("data-theme", this.theme);
  }

  async _initSidebar() {
    // 有记忆目录则显示文件树，否则显示选择目录引导（无论是否 Tauri）
    const dir = this.currentDir;
    if (dir) {
      await this._refreshFileTree(dir);
    } else {
      this._showPickDirGuide();
    }
  }

  /** 显示选择目录引导 */
  _showPickDirGuide() {
    const tree = document.getElementById("file-tree");
    tree.innerHTML = "";
    const guide = document.createElement("div");
    guide.className = "tree-guide";
    guide.innerHTML = `
      <div class="guide-icon">📂</div>
      <div class="guide-text">尚未选择工作区目录</div>
      <button class="guide-btn" id="guide-pick-dir">选择文件夹</button>
    `;
    tree.appendChild(guide);
    document.getElementById("guide-pick-dir").addEventListener("click", () => this.pickWorkspaceDir());
  }

  /** 选择 Windows 工作区目录 */
  async pickWorkspaceDir() {
    const dir = await api.pickDirectory();
    if (!dir) return;
    this.currentDir = dir;
    localStorage.setItem("md-lastdir", dir);
    await this._refreshFileTree(dir);
  }

  async _refreshFileTree(dir) {
    const tree = document.getElementById("file-tree");
    try {
      const entries = await api.listDir(dir);
      tree.innerHTML = "";
      // 顶部：目录名 + "更换目录"按钮
      const header = document.createElement("div");
      header.className = "tree-root-header";
      header.innerHTML = `
        <span class="tree-icon">📁</span>
        <span class="tree-name" title="${dir}">${this._baseName(dir)}</span>
        <button class="tree-change-dir" title="更换目录">⟳</button>
      `;
      header.querySelector(".tree-change-dir").addEventListener("click", (e) => {
        e.stopPropagation();
        this.pickWorkspaceDir();
      });
      tree.appendChild(header);
      this._renderTreeChildren(entries, tree, 1);
    } catch (e) {
      tree.innerHTML = `<div class="tree-item">无法读取目录: ${e}</div>`;
    }
  }

  _renderTreeChildren(entries, parent, depth) {
    const ul = document.createElement("div");
    ul.className = "tree-children";
    for (const e of entries) {
      const item = document.createElement("div");
      item.className = "tree-item";
      item.style.paddingLeft = `${8 + depth * 16}px`;
      const icon = e.is_dir ? "📁" : (e.name.endsWith(".md") || e.name.endsWith(".markdown") ? "📝" : "📄");
      item.innerHTML = `<span class="tree-icon">${icon}</span><span class="tree-name">${e.name}</span>`;
      if (!e.is_dir) {
        item.addEventListener("click", () => this._openFromTree(e.path, e.name));
      } else {
        item.addEventListener("click", async () => {
          const expanded = item.dataset.expanded === "1";
          if (expanded) {
            item.dataset.expanded = "0";
            const next = item.nextElementSibling;
            if (next && next.classList.contains("tree-children")) next.remove();
          } else {
            item.dataset.expanded = "1";
            try {
              const sub = await api.listDir(e.path);
              this._renderTreeChildren(sub, item.parentElement, depth + 1);
            } catch (err) {
              /* 忽略 */
            }
          }
        });
      }
      ul.appendChild(item);
    }
    parent.appendChild(ul);
  }

  async _openFromTree(path, name) {
    try {
      const content = await api.readFile(path);
      this.newTab(content, name, path);
    } catch (e) {
      alert("打开失败: " + e);
    }
  }

  _baseName(p) {
    return p.split(/[\\\/]/).pop() || p;
  }

  /** 新建标签页 */
  newTab(content = "", name = "未命名.md", path = null) {
    const id = "tab-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const tab = { id, path, name, content, dirty: false, editor: null };
    this.tabs.push(tab);
    this._renderTabs();
    this._activateTab(id, content);
  }

  /** 激活标签 */
  _activateTab(id, content) {
    this.activeTabId = id;
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.editor.setContent(content !== undefined ? content : tab.content);
    document.getElementById("current-file-name").textContent = tab.name + (tab.dirty ? " •" : "");
    // 同步窗口标题
    if (api.env.isTauri) {
      api.setWindowTitle(`${tab.name} - MD 编辑器`);
    }
    this._renderTabs();
    this._updateStatus();
  }

  /** 关闭标签 */
  async closeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = this.tabs[idx];
    if (tab.dirty) {
      if (!confirm(`"${tab.name}" 有未保存的修改，确定关闭？`)) return;
    }
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.newTab("", "未命名.md");
    } else if (this.activeTabId === id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this._activateTab(next.id);
    }
    this._renderTabs();
  }

  /** 内容变化回调 */
  _onContentChange(content, dirty) {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab) {
      tab.content = content;
      if (dirty) {
        tab.dirty = true;
        document.getElementById("current-file-name").textContent = tab.name + " •";
        this._renderTabs();
        this._scheduleAutoSave();
      }
    }
    this._updateStatus();
  }

  /** 自动保存（防抖） */
  _scheduleAutoSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      const tab = this.tabs.find((t) => t.id === this.activeTabId);
      if (tab && tab.path && tab.dirty) {
        try {
          await api.writeFile(tab.path, tab.content);
          tab.dirty = false;
          document.getElementById("current-file-name").textContent = tab.name;
          this._renderTabs();
        } catch (e) {
          /* 自动保存失败静默 */
        }
      }
    }, 2000);
  }

  /** 打开文件 */
  async openFile() {
    const path = await api.openFile();
    if (!path) return;
    try {
      const content = await api.readFile(path);
      const name = this._baseName(path);
      // 记忆文件所在目录
      const dir = path.replace(/[\\/][^\\/]+$/, "");
      if (dir) {
        this.currentDir = dir;
        localStorage.setItem("md-lastdir", dir);
      }
      const existing = this.tabs.find((t) => t.path === path);
      if (existing) {
        this._activateTab(existing.id, content);
        existing.content = content;
      } else {
        this.newTab(content, name, path);
      }
    } catch (e) {
      alert("打开失败: " + e);
    }
  }

  /** 保存当前 */
  async saveCurrent() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (tab.path) {
      try {
        await api.writeFile(tab.path, tab.content);
        tab.dirty = false;
        document.getElementById("current-file-name").textContent = tab.name;
        if (api.env.isTauri) api.setWindowTitle(`${tab.name} - MD 编辑器`);
        this._renderTabs();
      } catch (e) {
        alert("保存失败: " + e);
      }
    } else {
      // 另存为
      const path = await api.saveFile(tab.name);
      if (!path) return;
      try {
        await api.writeFile(path, tab.content);
        tab.path = path;
        tab.name = this._baseName(path);
        tab.dirty = false;
        document.getElementById("current-file-name").textContent = tab.name;
        if (api.env.isTauri) api.setWindowTitle(`${tab.name} - MD 编辑器`);
        this._renderTabs();
      } catch (e) {
        alert("保存失败: " + e);
      }
    }
  }

  /** 导出：弹出选择 HTML / PDF */
  async exportCurrent() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    const choice = confirm("确定 = 导出 HTML 文件\n取消 = 打印为 PDF");
    if (choice) {
      await this._exportHtml(tab);
    } else {
      await this._exportPdf(tab);
    }
  }

  /** 渲染完整 HTML（含 katex/mermaid）用于导出 */
  async _renderExportHtml(tab) {
    const { postRender } = await import("./postrender.js");
    const { text, placeholders } = extractInlineMath(tab.content);
    let html = parseMarkdown(text);
    html = restoreInlineMath(html, placeholders);
    const tmp = document.createElement("div");
    tmp.style.position = "fixed";
    tmp.style.left = "-9999px";
    tmp.style.top = "0";
    tmp.style.width = "820px";
    tmp.innerHTML = html;
    document.body.appendChild(tmp);
    await postRender(tmp);
    const inner = tmp.innerHTML;
    tmp.remove();
    const style = `body{max-width:820px;margin:auto;font-family:-apple-system,Segoe UI,'Microsoft YaHei',sans-serif;line-height:1.7;padding:32px;color:#303133}pre{background:#f6f8fa;padding:14px;border-radius:6px;overflow:auto}code{font-family:Consolas,monospace;font-size:.88em;background:#f6f8fa;padding:2px 5px;border-radius:3px}pre code{background:none;padding:0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 13px}th{background:#f6f8fa}blockquote{border-left:4px solid #dfe2e5;padding:4px 16px;color:#666;margin-left:0}img{max-width:100%}a{color:#4183c4}`;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${tab.name}</title><style>${style}</style></head><body>${inner}</body></html>`;
  }

  async _exportHtml(tab) {
    const fullHtml = await this._renderExportHtml(tab);
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tab.name.replace(/\.(md|markdown|txt)$/, "") + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  async _exportPdf(tab) {
    const fullHtml = await this._renderExportHtml(tab);
    const w = window.open("", "_blank");
    if (!w) {
      alert("请允许弹窗以导出 PDF");
      return;
    }
    w.document.write(fullHtml);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
    }, 600);
  }

  /** 主题切换 */
  toggleTheme() {
    this.theme = this.theme === "light" ? "dark" : "light";
    const light = document.getElementById("theme-light");
    const dark = document.getElementById("theme-dark");
    light.disabled = this.theme === "dark";
    dark.disabled = this.theme !== "dark";
    document.documentElement.setAttribute("data-theme", this.theme);
    localStorage.setItem("md-theme", this.theme);
    // 重新渲染 mermaid 以适配主题
    reinitMermaid();
    if (this.editor) {
      this.editor._render();
    }
  }

  /** 侧边栏 */
  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    document.getElementById("sidebar").classList.toggle("collapsed", this.sidebarCollapsed);
    localStorage.setItem("md-sidebar", this.sidebarCollapsed ? "closed" : "open");
  }

  /** 大纲 */
  toggleOutline() {
    this.outlineCollapsed = !this.outlineCollapsed;
    document.getElementById("outline").classList.toggle("collapsed", this.outlineCollapsed);
    localStorage.setItem("md-outline", this.outlineCollapsed ? "closed" : "open");
  }

  /** 大纲渲染 */
  _renderOutline(headings) {
    const list = document.getElementById("outline-list");
    if (!headings || headings.length === 0) {
      list.innerHTML = '<div class="outline-item" style="color:var(--text-secondary)">无标题</div>';
      return;
    }
    list.innerHTML = "";
    for (const h of headings) {
      const item = document.createElement("div");
      item.className = `outline-item h${h.level}`;
      item.textContent = h.text;
      item.addEventListener("click", () => {
        const el = document.getElementById(h.id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      list.appendChild(item);
    }
  }

  /** 渲染标签栏 */
  _renderTabs() {
    const bar = document.getElementById("tab-bar");
    bar.innerHTML = "";
    for (const t of this.tabs) {
      const tab = document.createElement("div");
      tab.className = "tab" + (t.id === this.activeTabId ? " active" : "") + (t.dirty ? " dirty" : "");
      tab.innerHTML = `<span class="tab-dot"></span><span class="tab-name">${t.name}</span><span class="tab-close">✕</span>`;
      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) {
          this.closeTab(t.id);
        } else {
          this._activateTab(t.id);
        }
      });
      bar.appendChild(tab);
    }
  }

  /** 状态栏 */
  _updateStatus() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    const content = tab ? tab.content : "";
    const charCount = content.length;
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    document.getElementById("status-info").textContent = tab ? `${tab.name}${tab.dirty ? " · 未保存" : " · 已保存"}` : "就绪";
    document.getElementById("status-stats").textContent = `${charCount} 字 · ${wordCount} 词`;
  }

  /** 全局快捷键 */
  _onGlobalKey(e) {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault();
          this.newTab();
          break;
        case "o":
          e.preventDefault();
          this.openFile();
          break;
        case "s":
          e.preventDefault();
          this.saveCurrent();
          break;
        case "t":
          if (e.shiftKey) {
            e.preventDefault();
            this.toggleTheme();
          }
          break;
        case "f":
          if (e.shiftKey) {
            e.preventDefault();
            this.toggleSearch();
          }
          break;
      }
    }
  }

  /** 切换全局搜索面板 */
  toggleSearch() {
    const panel = document.getElementById("search-panel");
    const willOpen = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if (willOpen) {
      setTimeout(() => document.getElementById("search-input").focus(), 50);
    }
  }

  /** 执行搜索（防抖） */
  _searchTimer = null;
  doSearch() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(async () => {
      const input = document.getElementById("search-input");
      const query = input.value.trim();
      const useRegex = document.getElementById("search-use-regex").checked;
      const results = document.getElementById("search-results");
      if (!query) {
        results.innerHTML = '<div class="search-empty">输入关键词搜索工作区内所有 Markdown 文件</div>';
        return;
      }
      if (!this.currentDir) {
        results.innerHTML = '<div class="search-empty">请先选择工作区目录</div>';
        return;
      }
      results.innerHTML = '<div class="search-empty">搜索中...</div>';
      try {
        const hits = await api.searchInDir(this.currentDir, query, useRegex);
        if (hits.length === 0) {
          results.innerHTML = '<div class="search-empty">未找到匹配项</div>';
          return;
        }
        results.innerHTML = "";
        const lq = query.toLowerCase();
        for (const hit of hits) {
          const item = document.createElement("div");
          item.className = "search-result-item";
          // 高亮匹配
          let hl = hit.text;
          if (!useRegex) {
            const idx = hl.toLowerCase().indexOf(lq);
            if (idx >= 0) {
              hl = escapeHtml(hl.slice(0, idx)) +
                "<mark>" + escapeHtml(hl.slice(idx, idx + query.length)) + "</mark>" +
                escapeHtml(hl.slice(idx + query.length));
            } else {
              hl = escapeHtml(hl);
            }
          } else {
            hl = escapeHtml(hl);
          }
          item.innerHTML = `<div class="search-result-file">${escapeHtml(hit.name)}:${hit.line}</div><div class="search-result-line">${hl}</div>`;
          item.addEventListener("click", () => this._openSearchHit(hit));
          results.appendChild(item);
        }
        results.innerHTML += `<div class="search-empty">${hits.length} 项匹配</div>`;
      } catch (e) {
        results.innerHTML = `<div class="search-empty">搜索失败: ${escapeHtml(String(e))}</div>`;
      }
    }, 300);
  }

  /** 点击搜索结果打开文件 */
  async _openSearchHit(hit) {
    try {
      const content = await api.readFile(hit.path);
      this.newTab(content, hit.name, hit.path);
      // 关闭搜索面板
      document.getElementById("search-panel").classList.add("hidden");
      // TODO: 跳转到具体行（当前整体渲染不支持行号定位）
    } catch (e) {
      alert("打开失败: " + e);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 启动
window.addEventListener("DOMContentLoaded", () => {
  window.__app = new App();
});
