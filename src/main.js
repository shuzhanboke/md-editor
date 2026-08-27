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

    // Git 面板
    document.getElementById("btn-git").addEventListener("click", () => this.toggleGitPanel());
    document.getElementById("git-close").addEventListener("click", () => this.toggleGitPanel(false));
    document.getElementById("git-refresh").addEventListener("click", () => this.refreshGit());
    document.getElementById("git-stage-all").addEventListener("click", () => this.gitStageAll());
    document.getElementById("git-commit-btn").addEventListener("click", () => this.gitCommit());
    document.getElementById("git-push-btn").addEventListener("click", () => this.gitPush());
    document.getElementById("git-save-remote").addEventListener("click", () => this.gitSaveRemote());
    document.getElementById("git-init-btn").addEventListener("click", () => this.gitInitRepo());

    // 文档图谱
    document.getElementById("btn-graph").addEventListener("click", () => this.toggleGraph());
    document.getElementById("graph-close").addEventListener("click", () => this.toggleGraph(false));

    // 一键发布
    document.getElementById("btn-publish").addEventListener("click", () => this.publishTo());

    // 格式工具栏
    this._initFormatToolbar();

    // 模式切换
    document.getElementById("btn-mode").addEventListener("click", () => this.toggleMode());
  }

  /** 切换源码/渲染模式 */
  toggleMode() {
    this.editor.toggleSourceMode();
    const btn = document.getElementById("btn-mode");
    if (this.editor.editing) {
      btn.textContent = "👁";
      btn.title = "切换到渲染模式";
      this._toast("源码模式");
    } else {
      btn.textContent = "📝";
      btn.title = "切换到源码模式";
      this._toast("渲染模式");
    }
  }

  _initFormatToolbar() {
    const toolbar = document.getElementById("format-toolbar");
    // 收起/展开
    const toggle = document.getElementById("toolbar-toggle");
    // 动态创建展开按钮
    const expand = document.createElement("button");
    expand.id = "toolbar-expand";
    expand.textContent = "▴";
    expand.title = "展开工具栏";
    expand.style.position = "absolute";
    expand.style.right = "12px";
    expand.style.top = "var(--titlebar-height)";
    document.body.appendChild(expand);
    expand.classList.add("show");
    expand.style.display = "none";

    const collapse = () => {
      toolbar.classList.add("collapsed");
      expand.style.display = "block";
    };
    const expandFn = () => {
      toolbar.classList.remove("collapsed");
      expand.style.display = "none";
    };
    toggle.addEventListener("click", collapse);
    expand.addEventListener("click", expandFn);

    // 工具栏记忆
    if (localStorage.getItem("md-toolbar") === "collapsed") collapse();

    // 格式按钮
    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest(".ft-btn");
      if (!btn) return;
      const fmt = btn.dataset.fmt;
      this._insertFormat(fmt);
    });

    // 工具栏记忆
    if (localStorage.getItem("md-toolbar") === "collapsed") {
      toolbar.classList.add("collapsed");
      expand.style.display = "block";
    }
    // 工具栏状态保存
    new MutationObserver(() => {
      localStorage.setItem("md-toolbar", toolbar.classList.contains("collapsed") ? "collapsed" : "open");
    }).observe(toolbar, { attributes: true, attributeFilter: ["class"] });
  }

  /** 插入格式 markdown（适配双模式） */
  _insertFormat(fmt) {
    // 包裹型格式
    const wrapMap = {
      bold: ["**", "**"], italic: ["*", "*"], strike: ["~~", "~~"], code: ["`", "`"],
      link: ["[", "](url)"],
    };
    if (fmt in wrapMap) {
      const [before, after] = wrapMap[fmt];
      if (this.editor.editing) {
        this._wrapInEditor(before, after, "");
      } else {
        this.editor.applyWrapFormat(before, after);
      }
      return;
    }

    // 行首型格式
    const lineMap = {
      h1: "# ", h2: "## ", h3: "### ", h4: "#### ",
      ul: "- ", ol: "1. ", task: "- [ ] ", quote: "> ",
    };
    if (fmt in lineMap) {
      if (this.editor.editing) {
        this._insertAtLineStart(lineMap[fmt]);
      } else {
        this.editor.applyLineFormat(lineMap[fmt]);
      }
      return;
    }

    // 插入型格式
    const insertMap = {
      hr: "\n---\n",
      image: "![描述](url)",
      table: "\n| 列1 | 列2 |\n|---|---|\n| 内容 | 内容 |\n",
      codeblock: "\n```js\n\n```\n",
      math: "\n$$\n\n$$\n",
      mermaid: "\n```mermaid\ngraph TD\n  A-->B\n```\n",
    };
    if (fmt in insertMap) {
      this.editor.insertSnippet(insertMap[fmt]);
    }
  }

  /** 在编辑态源码中查找选中文本并选中 */
  _selectInEditor(text) {
    const ed = this.editor.root;
    const fullText = ed.textContent;
    const idx = fullText.indexOf(text);
    if (idx >= 0) {
      const textNode = ed.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, idx + text.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  /** 在编辑态包裹选中文本 */
  _wrapInEditor(before, after, fallbackText) {
    const sel = window.getSelection();
    const ed = this.editor.root;
    if (sel && sel.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const text = sel.toString();
      range.deleteContents();
      const node = document.createTextNode(before + text + after);
      range.insertNode(node);
      // 选中包裹后的原文部分（不含标记）
      const newRange = document.createRange();
      newRange.setStart(node, before.length);
      newRange.setEnd(node, before.length + text.length);
      sel.removeAllRanges();
      sel.addRange(newRange);
      this.editor.source = ed.textContent;
      this.editor.onChange(this.editor.source, true);
    } else {
      // 无选中文本：插入占位并选中占位词
      const placeholder = fallbackText || (after.startsWith("]") ? "描述" : "文本");
      this.editor.insertAtCursor(before + placeholder + after);
      // 选中占位词
      const r2 = window.getSelection();
      if (r2 && r2.rangeCount) {
        const textNode = ed.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const full = ed.textContent;
          const pi = full.lastIndexOf(placeholder);
          if (pi >= 0) {
            const nr = document.createRange();
            nr.setStart(textNode, pi);
            nr.setEnd(textNode, pi + placeholder.length);
            r2.removeAllRanges();
            r2.addRange(nr);
          }
        }
      }
    }
  }

  /** 在当前行首插入前缀 */
  _insertAtLineStart(prefix) {
    const ed = this.editor.root;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      this.editor.insertAtCursor(prefix);
      return;
    }
    const range = sel.getRangeAt(0);
    // 找到当前行起始位置
    const textNode = ed.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      this.editor.insertAtCursor(prefix);
      return;
    }
    const cursorOffset = range.startOffset;
    const fullText = textNode.textContent;
    // 向前找换行符
    let lineStart = fullText.lastIndexOf("\n", cursorOffset - 1);
    lineStart = lineStart < 0 ? 0 : lineStart + 1;
    // 在行首插入 prefix
    const newRange = document.createRange();
    newRange.setStart(textNode, lineStart);
    newRange.setEnd(textNode, lineStart);
    newRange.insertNode(document.createTextNode(prefix));
    // 光标移到 prefix 后
    const afterOffset = lineStart + prefix.length;
    newRange.setStart(textNode, afterOffset);
    newRange.setEnd(textNode, afterOffset);
    sel.removeAllRanges();
    sel.addRange(newRange);
    this.editor.source = ed.textContent;
    this.editor.onChange(this.editor.source, true);
  }

  /** 切换 Git 面板 */
  toggleGitPanel(open) {
    const panel = document.getElementById("git-panel");
    const willOpen = open !== undefined ? open : panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !willOpen);
    if (willOpen) this.refreshGit();
  }

  /** 刷新 git 状态 */
  async refreshGit() {
    if (!this.currentDir) {
      this._toast("请先选择工作区目录");
      return;
    }
    try {
      const branch = await api.gitBranch(this.currentDir);
      document.getElementById("git-branch").textContent = `分支: ${branch || "main"}`;
      // 加载 remote URL
      const remote = await api.gitGetRemote(this.currentDir);
      document.getElementById("git-remote-url").value = remote || localStorage.getItem("md-git-remote") || "";
    } catch (e) {
      // 非 git 仓库：显示引导初始化
      document.getElementById("git-branch").textContent = '分支: 未初始化（点击下方「初始化」按钮）';
      document.getElementById("git-files").innerHTML = `<div class="search-empty">该目录尚未初始化 Git 仓库<br>请在下方"仓库配置"区域点击"初始化"按钮</div>`;
      document.getElementById("git-remote-url").value = localStorage.getItem("md-git-remote") || "";
      return;
    }
    // 变更文件
    try {
      const files = await api.gitStatus(this.currentDir);
      const box = document.getElementById("git-files");
      if (files.length === 0) {
        box.innerHTML = '<div class="search-empty">工作区干净，无变更</div>';
      } else {
        box.innerHTML = "";
        for (const f of files) {
          const item = document.createElement("div");
          item.className = "git-file-item";
          const badgeText = f.status[0].toUpperCase();
          item.innerHTML = `<span class="git-badge ${f.status}">${badgeText}</span><span class="git-file-path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>`;
          item.addEventListener("click", () => this.gitAddFiles([f.path]));
          box.appendChild(item);
        }
      }
    } catch (e) {
      document.getElementById("git-files").innerHTML = `<div class="search-empty">状态获取失败</div>`;
    }
    // 提交历史
    try {
      const log = await api.gitLog(this.currentDir, 15);
      const logBox = document.getElementById("git-log");
      logBox.innerHTML = "";
      for (const c of log) {
        const item = document.createElement("div");
        item.className = "git-log-item";
        item.innerHTML = `<div class="git-log-msg">${escapeHtml(c.message)}</div><div class="git-log-meta">${escapeHtml(c.author)} · ${escapeHtml(c.date)}</div>`;
        logBox.appendChild(item);
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  /** 暂存指定文件 */
  async gitAddFiles(paths) {
    try {
      await api.gitAdd(this.currentDir, paths);
      this._toast(`已暂存 ${paths.length} 个文件`);
      this.refreshGit();
    } catch (e) {
      alert("暂存失败: " + e);
    }
  }

  /** 全部暂存 */
  async gitStageAll() {
    await this.gitAddFiles(["."]);
  }

  /** 提交 */
  async gitCommit() {
    const msg = document.getElementById("git-message").value.trim();
    if (!msg) {
      this._toast("请输入提交信息");
      return;
    }
    try {
      await api.gitCommit(this.currentDir, msg);
      document.getElementById("git-message").value = "";
      this._toast("提交成功");
      this.refreshGit();
    } catch (e) {
      alert("提交失败: " + e);
    }
  }

  /** 推送 */
  async gitPush() {
    this._toast("推送中...");
    try {
      await api.gitPush(this.currentDir);
      this._toast("推送成功");
      this.refreshGit();
    } catch (e) {
      alert("推送失败: " + e + "\n（若网络受限，可用 gh 或 GitHub API 推送）");
    }
  }

  /** 保存/设置 remote URL */
  async gitSaveRemote() {
    const url = document.getElementById("git-remote-url").value.trim();
    if (!url) {
      this._toast("请输入远程仓库 URL");
      return;
    }
    localStorage.setItem("md-git-remote", url);
    try {
      await api.gitSetRemote(this.currentDir, url);
      this._toast("远程仓库已设置");
      this.refreshGit();
    } catch (e) {
      alert("设置 remote 失败: " + e);
    }
  }

  /** 初始化 git 仓库 */
  async gitInitRepo() {
    try {
      await api.gitInit(this.currentDir);
      this._toast("Git 仓库已初始化");
      this.refreshGit();
    } catch (e) {
      alert("初始化失败: " + e);
    }
  }

  /** 切换文档图谱 */
  toggleGraph(open) {
    const modal = document.getElementById("graph-modal");
    const willOpen = open !== undefined ? open : modal.classList.contains("hidden");
    modal.classList.toggle("hidden", !willOpen);
    if (willOpen) this.renderGraph();
  }

  /** 渲染关系图谱（圆周分布 + 连线） */
  async renderGraph() {
    const svg = document.getElementById("graph-svg");
    const empty = document.getElementById("graph-empty");
    if (!this.currentDir) {
      empty.textContent = "请先选择工作区目录";
      empty.style.display = "flex";
      return;
    }
    let data;
    try {
      data = await api.scanLinks(this.currentDir);
    } catch (e) {
      empty.textContent = "扫描失败: " + e;
      empty.style.display = "flex";
      return;
    }
    if (!data.nodes || data.nodes.length === 0) {
      empty.textContent = "工作区无 Markdown 文件，请选择含 .md 文件的目录";
      empty.style.display = "flex";
      svg.innerHTML = "";
      return;
    }
    empty.style.display = "none";
    const w = svg.clientWidth || 740;
    const h = svg.clientHeight || 460;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 50;
    // 节点圆周分布
    const pos = {};
    data.nodes.forEach((n, i) => {
      const angle = (i / data.nodes.length) * Math.PI * 2;
      pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
    let html = "";
    // 连线
    for (const e of data.edges) {
      const a = pos[e.source], b = pos[e.target];
      if (a && b) {
        html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent-color)" stroke-width="1" opacity="0.4"/>`;
      }
    }
    // 节点
    for (const n of data.nodes) {
      const p = pos[n.id];
      html += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="var(--accent-color)" stroke="var(--bg-content)" stroke-width="2" data-path="${escapeAttr(n.path)}" style="cursor:pointer"><title>${escapeHtml(n.id)}</title></circle>`;
      html += `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="11" fill="var(--text-color)">${escapeHtml(n.id.slice(0, 12))}</text>`;
    }
    svg.innerHTML = html;
    // 点击节点打开文件
    svg.querySelectorAll("circle").forEach((c) => {
      c.addEventListener("click", () => {
        const p = c.getAttribute("data-path");
        const name = p.split(/[\\\/]/).pop();
        this._openFromTree(p, name);
        this.toggleGraph(false);
      });
    });
  }

  /** 一键发布到平台 */
  async publishTo() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    // 合并预设平台与用户自定义平台
    const defaults = [
      { name: "知乎", url: "https://zhuanlan.zhihu.com/write", adapt: "wechat" },
      { name: "微信公众号", url: "https://mp.weixin.qq.com/", adapt: "wechat" },
      { name: "语雀", url: "https://www.yuque.com/new", adapt: "normal" },
      { name: "掘金", url: "https://juejin.cn/editor/drafts/new?v=2", adapt: "normal" },
    ];
    const custom = JSON.parse(localStorage.getItem("md-publish-platforms") || "[]");
    const all = [...defaults, ...custom];
    // 构建选项
    let opts = "选择发布平台（输入数字，0 = 添加自定义平台）：\n";
    all.forEach((p, i) => { opts += `${i + 1} = ${p.name}${p.url ? "" : "（仅复制）"}\n`; });
    opts += "0 = 添加自定义平台";
    const choice = prompt(opts, "1");
    const idx = parseInt((choice || "").trim(), 10);
    if (idx === 0) {
      this._addPublishPlatform();
      return;
    }
    const p = all[idx - 1];
    if (!p) return;
    const inner = await this._renderExportHtml(tab);
    const body = inner.match(/<body>([\s\S]*)<\/body>/)?.[1] || inner;
    let html = body;
    if (p.adapt === "wechat") {
      html = this._inlineStyles(body);
    }
    await this._copyToClipboard(html, html.replace(/<[^>]+>/g, ""));
    this._toast(`已复制${p.name}适配内容，即将打开发布页`);
    if (p.url) {
      setTimeout(() => window.open(p.url, "_blank"), 800);
    } else {
      alert(`${p.name}：内容已复制，请粘贴到你的编辑器`);
    }
  }

  /** 添加自定义发布平台 */
  _addPublishPlatform() {
    const name = prompt("平台名称（如：CSDN）");
    if (!name) return;
    const url = prompt("发布页 URL（留空则仅复制到剪贴板）") || "";
    const adapt = confirm("该平台需要微信内联样式适配吗？\n确定 = 需要（微信公众号类）\n取消 = 不需要") ? "wechat" : "normal";
    const custom = JSON.parse(localStorage.getItem("md-publish-platforms") || "[]");
    custom.push({ name, url, adapt });
    localStorage.setItem("md-publish-platforms", JSON.stringify(custom));
    this._toast(`已添加平台「${name}」`);
    this.publishTo();
  }

  /** 微信适配：给元素加内联样式 */
  _inlineStyles(html) {
    // 简单内联：包裹 section 加基本样式
    const styled = html
      .replace(/<h1/g, '<h1 style="font-size:22px;font-weight:bold;margin:1em 0 .5em"')
      .replace(/<h2/g, '<h2 style="font-size:18px;font-weight:bold;margin:1em 0 .5em"')
      .replace(/<h3/g, '<h3 style="font-size:16px;font-weight:bold;margin:1em 0 .5em"')
      .replace(/<p/g, '<p style="margin:.6em 0;line-height:1.7"')
      .replace(/<pre/g, '<pre style="background:#f6f8fa;padding:14px;border-radius:6px;overflow:auto;font-size:13px"')
      .replace(/<blockquote/g, '<blockquote style="border-left:4px solid #dfe2e5;padding:4px 16px;color:#666;margin:1em 0"')
      .replace(/<code/g, '<code style="background:#f6f8fa;padding:2px 5px;border-radius:3px;font-size:.9em"')
      .replace(/<img/g, '<img style="max-width:100%"')
      .replace(/<a /g, '<a style="color:#4183c4" ');
    return `<section style="font-size:15px;color:#303133">${styled}</section>`;
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
      if (action && action.startsWith("fmt-")) {
        const fmt = action.slice(4);
        this._insertFormat(fmt);
      } else {
        this._doCopy(action);
      }
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
    // 弹出格式选择菜单
    const choice = prompt("导出格式，输入数字：\n1 = HTML\n2 = PDF（打印）\n3 = Word（.docx）\n4 = Epub 电子书", "1");
    const fmt = (choice || "").trim();
    if (fmt === "1") await this._exportHtml(tab);
    else if (fmt === "2") await this._exportPdf(tab);
    else if (fmt === "3") await this._exportDocx(tab);
    else if (fmt === "4") await this._exportEpub(tab);
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

  /** 导出 Word（.docx，实际为 Word 兼容 HTML，扩展名 .doc） */
  async _exportDocx(tab) {
    const inner = await this._renderExportHtml(tab);
    // Word 能直接打开带 Office 命名空间的 HTML
    const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><title>${tab.name}</title></head><body>${inner.match(/<body>([\s\S]*)<\/body>/)?.[1] || inner}</body></html>`;
    const blob = new Blob([`\ufeff${docHtml}`], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tab.name.replace(/\.(md|markdown|txt)$/, "") + ".doc";
    a.click();
    URL.revokeObjectURL(url);
    this._toast("已导出 Word");
  }

  /** 导出 Epub（最小标准 epub 结构） */
  async _exportEpub(tab) {
    const JSZip = (await import("jszip")).default;
    const inner = await this._renderExportHtml(tab);
    const body = inner.match(/<body>([\s\S]*)<\/body>/)?.[1] || inner;
    const title = tab.name.replace(/\.(md|markdown|txt)$/, "");
    const zip = new JSZip();
    // mimetype（必须无压缩）
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
    // META-INF/container.xml
    zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
    // OEBPS/content.opf
    zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${title}</dc:title>
<dc:language>zh-CN</dc:language>
<dc:identifier id="bookid">md-editor-${Date.now()}</dc:identifier>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine toc="ncx"><itemref idref="ch1"/></spine>
</package>`);
    // OEBPS/toc.ncx
    zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="md-editor-${Date.now()}"/></head>
<navMap><navPoint id="np1" playOrder="1"><navLabel><text>${title}</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap>
</ncx>`);
    // OEBPS/ch1.xhtml
    zip.file("OEBPS/ch1.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`);
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title + ".epub";
    a.click();
    URL.revokeObjectURL(url);
    this._toast("已导出 Epub");
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
      // 格式快捷键（需编辑区有焦点）
      const edFocused = document.getElementById("editor").contains(document.activeElement) || document.activeElement.id === "editor";
      if (edFocused && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "b":
            e.preventDefault();
            this._insertFormat("bold");
            return;
          case "i":
            e.preventDefault();
            this._insertFormat("italic");
            return;
          case "k":
            e.preventDefault();
            this._insertFormat("link");
            return;
        }
      }
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
        case "g":
          if (e.shiftKey) {
            e.preventDefault();
            this.toggleGitPanel();
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
