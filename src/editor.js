// 即时渲染编辑器（双模式）
//
// 模式：
//   - 渲染模式（默认）：显示渲染结果，contenteditable=false，可选中文字
//     选中后点工具栏 → 在 source 中定位选中文本并包裹格式标记 → 重新渲染
//   - 源码模式：contenteditable=true，显示纯文本 source，可直接编辑
// 手动切换：toggleSourceMode()

import { parseMarkdown } from "./markdown.js";
import { postRender } from "./postrender.js";

export class Editor {
  constructor(rootEl, onChange, onHeadingsChange) {
    this.root = rootEl;
    this.onChange = onChange || (() => {});
    this.onHeadingsChange = onHeadingsChange || (() => {});
    this.source = "";
    this.editing = false; // 源码模式
    this.suppress = false;
    this.vimMode = "normal";
    this._renderTimer = null;

    this._bind();
  }

  _bind() {
    this.root.addEventListener("input", (e) => this._onInput(e));
    this.root.addEventListener("keydown", (e) => this._onKeydown(e));
    // 源码模式失焦时保持（不自动切回，让用户手动切换）
  }

  /** 设置内容（渲染模式） */
  setContent(md) {
    this.source = md || "";
    this.editing = false;
    this.root.contentEditable = "false";
    this._render();
    this.onChange(this.source, false);
  }

  getContent() {
    return this.source;
  }

  /** 整体渲染 */
  _render() {
    this.suppress = true;
    this.root.contentEditable = "false";
    this.root.classList.remove("editing-mode", "vim-insert");
    if (!this.source.trim()) {
      this.root.innerHTML = "<p><br></p>";
    } else {
      this.root.innerHTML = parseMarkdown(this.source);
    }
    postRender(this.root).finally(() => {
      this.suppress = false;
      this.onHeadingsChange(this.getHeadings());
    });
  }

  /** 切换源码/渲染模式 */
  toggleSourceMode() {
    if (this.editing) {
      // 源码 → 渲染
      this.source = this.root.textContent;
      this.editing = false;
      this._vimStatus(null);
      this._render();
      this.onChange(this.source, false);
    } else {
      // 渲染 → 源码
      this.editing = true;
      this.vimMode = "normal";
      this.root.innerHTML = "";
      this.root.textContent = this.source;
      this.root.contentEditable = "true";
      this.root.classList.add("editing-mode");
      this.root.focus();
      // 光标到末尾
      const range = document.createRange();
      range.selectNodeContents(this.root);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      this.onChange(this.source, true);
    }
  }

  /** 渲染模式下：在选中文本处应用包裹格式（在 source 层面操作） */
  applyWrapFormat(before, after) {
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount ? sel.toString() : "";
    if (!selectedText) {
      // 无选中：在末尾插入占位
      this.source += before + "文本" + after;
      this._render();
      this.onChange(this.source, true);
      return;
    }
    // 在 source 中查找选中文本（取纯文本，可能有多次出现，取第一个）
    const idx = this.source.indexOf(selectedText);
    if (idx >= 0) {
      this.source = this.source.slice(0, idx) + before + selectedText + after + this.source.slice(idx + selectedText.length);
    } else {
      // 找不到（可能是渲染后的文本与 source 不完全一致），追加到末尾
      this.source += "\n" + before + selectedText + after;
    }
    this._render();
    this.onChange(this.source, true);
  }

  /** 渲染模式下：在选中文本所在行首插入前缀 */
  applyLineFormat(prefix) {
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount ? sel.toString() : "";
    if (!selectedText) {
      this.source += "\n" + prefix + "文本";
      this._render();
      this.onChange(this.source, true);
      return;
    }
    // 在 source 中找选中文本，定位其所在行首
    const idx = this.source.indexOf(selectedText);
    if (idx >= 0) {
      const before = this.source.slice(0, idx);
      const lineStart = before.lastIndexOf("\n") + 1;
      this.source = this.source.slice(0, lineStart) + prefix + this.source.slice(lineStart);
    } else {
      this.source += "\n" + prefix + selectedText;
    }
    this._render();
    this.onChange(this.source, true);
  }

  /** 渲染模式下：在末尾插入片段 */
  insertSnippet(snippet) {
    if (this.editing) {
      // 源码模式：在光标处插入
      this._insertAtCursor(snippet);
    } else {
      this.source += (this.source && !this.source.endsWith("\n") ? "\n" : "") + snippet;
      this._render();
      this.onChange(this.source, true);
    }
  }

  /** 源码模式下在光标处插入文本 */
  _insertAtCursor(text) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    this.source = this.root.textContent;
    this.onChange(this.source, true);
  }

  /** 兼容旧接口 insertAtCursor */
  insertAtCursor(mdText) {
    if (this.editing) {
      this._insertAtCursor(mdText);
    } else {
      this.insertSnippet(mdText);
    }
  }

  /** 源码模式输入 */
  _onInput(e) {
    if (!this.editing || this.suppress) return;
    this.source = this.root.textContent;
    this.onChange(this.source, true);
  }

  /** 源码模式键盘 */
  _onKeydown(e) {
    if (!this.editing) return;
    if (e.key === "Escape") {
      if (this.vimMode === "insert") {
        this.vimMode = "normal";
        this.root.classList.remove("vim-insert");
        this._vimStatus("NORMAL");
        e.preventDefault();
        return;
      }
      e.preventDefault();
      this.toggleSourceMode();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this._insertAtCursor("  ");
      return;
    }
    if (this.vimMode === "normal") {
      this._handleVimNormal(e);
      return;
    }
  }

  /** Vim normal 模式 */
  _handleVimNormal(e) {
    const k = e.key;
    const handled = ["h", "j", "k", "l", "i", "a", "o", "x", "0", "$", "w", "b", "G", "g", ":", "u"];
    if (!handled.includes(k)) return;
    e.preventDefault();
    const sel = window.getSelection();
    if (k === "i") { this.vimMode = "insert"; this.root.classList.add("vim-insert"); this._vimStatus("INSERT"); }
    else if (k === "a") { this._moveCursor("right"); this.vimMode = "insert"; this.root.classList.add("vim-insert"); this._vimStatus("INSERT"); }
    else if (k === "o") { this._insertAtCursor("\n"); this.vimMode = "insert"; this._vimStatus("INSERT"); }
    else if (k === "h") this._moveCursor("left");
    else if (k === "l") this._moveCursor("right");
    else if (k === "j") this._moveCursor("down");
    else if (k === "k") this._moveCursor("up");
    else if (k === "0") this._moveCursor("line-start");
    else if (k === "$") this._moveCursor("line-end");
    else if (k === "w") this._moveCursor("word-forward");
    else if (k === "b") this._moveCursor("word-back");
    else if (k === "G") this._moveCursor("doc-end");
    else if (k === "x") this._deleteChar();
    else if (k === ":") this._vimCommand();
    else if (k === "u") document.execCommand("undo");
  }

  _moveCursor(dir) {
    const sel = window.getSelection();
    if (!sel.modify) return;
    const map = { left: "backward", right: "forward", up: "up", down: "down" };
    if (map[dir]) sel.modify("move", map[dir], "character");
    else if (dir === "line-start" || dir === "line-end") sel.modify("move", dir === "line-start" ? "backward" : "forward", "lineboundary");
    else if (dir === "word-forward") sel.modify("move", "forward", "word");
    else if (dir === "word-back") sel.modify("move", "backward", "word");
    else if (dir === "doc-end") { const r = document.createRange(); r.selectNodeContents(this.root); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  }

  _deleteChar() {
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.deleteContents();
      try { r.setEnd(r.endContainer, r.endOffset + 1); } catch {}
      r.deleteContents();
      this.source = this.root.textContent;
      this.onChange(this.source, true);
    }
  }

  _vimCommand() {
    const cmd = prompt("Vim 命令 (w=保存 q=退出 wq=保存退出)");
    if (!cmd) return;
    if (cmd.includes("w")) this.onChange(this.source, true);
    if (cmd.includes("q")) this.toggleSourceMode();
    this._vimStatus("NORMAL");
  }

  _vimStatus(mode) {
    let el = document.getElementById("vim-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "vim-status";
      el.style.cssText = "position:fixed;bottom:var(--statusbar-height);right:8px;background:var(--accent-color);color:#fff;padding:2px 10px;font-size:12px;font-weight:600;border-radius:4px 4px 0 0;z-index:999";
      document.body.appendChild(el);
    }
    el.textContent = mode ? `-- ${mode} --` : "";
    el.style.display = mode ? "block" : "none";
  }

  /** 大纲 */
  getHeadings() {
    const headings = [];
    this.root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const level = parseInt(h.tagName[1], 10);
      const text = h.textContent;
      let id = h.id || ("h-" + Math.random().toString(36).slice(2, 8));
      h.id = id;
      headings.push({ level, text, id });
    });
    return headings;
  }
}
