// 即时渲染编辑器（整体渲染方案）
//
// 模型：source 是唯一真相。两种态：
//   - 渲染态：editor.innerHTML = parseMarkdown(source)，只读展示
//   - 编辑态：点击进入，editor 显示纯文本 source（contenteditable），可编辑
//   失焦/ESC → 回到渲染态，重新解析。渲染 100% 完整，无块拆分问题。
//
// 这是 Typora 式"源码/预览"切换：所见即所得，点击即编辑。

import { parseMarkdown } from "./markdown.js";
import { postRender } from "./postrender.js";

export class Editor {
  constructor(rootEl, onChange, onHeadingsChange) {
    this.root = rootEl;
    this.onChange = onChange || (() => {});
    this.onHeadingsChange = onHeadingsChange || (() => {});
    this.source = "";
    this.editing = false; // 是否处于源码编辑态
    this.suppress = false;
    this.vimMode = "normal"; // Vim 模式：normal / insert
    this._renderTimer = null;

    this._bind();
  }

  _bind() {
    this.root.addEventListener("click", (e) => this._onClick(e));
    this.root.addEventListener("input", (e) => this._onInput(e));
    this.root.addEventListener("keydown", (e) => this._onKeydown(e));
    // 失焦时回到渲染态
    this.root.addEventListener("blur", () => this.commitEditing(), true);
  }

  /** 设置内容（渲染态） */
  setContent(md) {
    this.source = md || "";
    this.editing = false;
    this._render();
    this.onChange(this.source, false);
  }

  getContent() {
    return this.source;
  }

  /** 整体渲染：一次性解析全部 source */
  _render() {
    this.suppress = true;
    if (!this.source.trim()) {
      this.root.innerHTML = "<p><br></p>";
    } else {
      this.root.innerHTML = parseMarkdown(this.source);
    }
    // 后渲染（数学、mermaid）异步
    postRender(this.root).finally(() => {
      this.suppress = false;
      this.onHeadingsChange(this.getHeadings());
    });
  }

  /** 点击：进入源码编辑态 */
  _onClick(e) {
    if (this.editing) return;
    this._enterEdit(e);
  }

  /** 进入编辑态：显示纯文本 source */
  _enterEdit(evt) {
    this.editing = true;
    this.vimMode = "normal";
    this.root.textContent = this.source;
    // 标记编辑态，便于样式区分
    this.root.classList.add("editing-mode");
    this._placeCursor(evt);
    this.root.focus();
    this.onChange(this.source, true);
  }

  /** 提交编辑：回到渲染态 */
  commitEditing() {
    if (!this.editing) return;
    this.source = this.root.textContent;
    this.editing = false;
    this.vimMode = "normal";
    this.root.classList.remove("editing-mode", "vim-insert");
    this._vimStatus(null);
    this._render();
    this.onChange(this.source, false);
  }

  /** 编辑态输入：同步 source */
  _onInput(e) {
    if (!this.editing || this.suppress) return;
    this.source = this.root.textContent;
    this.onChange(this.source, true);
    // 防抖触发大纲更新（编辑态不渲染，但可统计）
    if (this._renderTimer) clearTimeout(this._renderTimer);
  }

  /** 键盘处理 */
  _onKeydown(e) {
    if (!this.editing) return;
    // ESC：退出编辑态（或 Vim 从 insert 回 normal）
    if (e.key === "Escape") {
      if (this.vimMode === "insert") {
        this.vimMode = "normal";
        this.root.classList.remove("vim-insert");
        this._vimStatus("NORMAL");
        e.preventDefault();
        return;
      }
      e.preventDefault();
      this.commitEditing();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this._insertText("  ");
      return;
    }
    // Vim 模式
    if (this.vimMode === "normal") {
      this._handleVimNormal(e);
      return;
    }
  }

  /** Vim normal 模式键位 */
  _handleVimNormal(e) {
    const k = e.key;
    const handled = ["h", "j", "k", "l", "i", "a", "o", "O", "x", "0", "$", "w", "b", "G", "g", ":", "d", "u", "e"];
    if (!handled.includes(k) && k !== "Enter" && k !== "Backspace") return;
    e.preventDefault();
    const sel = window.getSelection();
    if (k === "i") { this.vimMode = "insert"; this.root.classList.add("vim-insert"); this._vimStatus("INSERT"); }
    else if (k === "a") { this._moveCursor("right"); this.vimMode = "insert"; this.root.classList.add("vim-insert"); this._vimStatus("INSERT"); }
    else if (k === "o") { this._insertText("\n"); this.vimMode = "insert"; this._vimStatus("INSERT"); }
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

  /** 移动光标 */
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

  /** 删除当前字符 */
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

  /** Vim 命令（:w :q 等） */
  _vimCommand() {
    // 简化：用 prompt 接收命令
    const cmd = prompt("Vim 命令 (w=保存 q=退出 wq=保存退出)");
    if (!cmd) return;
    if (cmd.includes("w")) this.onChange(this.source, true); // 触发保存逻辑
    if (cmd.includes("q")) { this.vimMode = "normal"; this.commitEditing(); }
    this._vimStatus("NORMAL");
  }

  /** Vim 状态提示 */
  _vimStatus(mode) {
    let el = document.getElementById("vim-status");
    if (!el) {
      el = document.createElement("div");
      el.id = "vim-status";
      el.style.cssText = "position:fixed;bottom:var(--statusbar-height);right:8px;background:var(--accent-color);color:#fff;padding:2px 10px;font-size:12px;font-weight:600;border-radius:4px 4px 0 0;z-index:999";
      document.body.appendChild(el);
    }
    el.textContent = `-- ${mode} --`;
    el.style.display = mode ? "block" : "none";
  }

  /** 插入文本到光标处 */
  _insertText(text) {
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

  /** 放置光标：点击处或末尾 */
  _placeCursor(evt) {
    const sel = window.getSelection();
    const range = document.createRange();
    // 编辑态下 root 只有一个文本节点，尝试定位到点击位置
    if (this.root.firstChild && this.root.firstChild.nodeType === Node.TEXT_NODE) {
      const textNode = this.root.firstChild;
      if (evt && evt.offset !== undefined) {
        try {
          range.setStart(textNode, Math.min(evt.offset, textNode.length));
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          return;
        } catch {
          /* fallthrough */
        }
      }
    }
    range.selectNodeContents(this.root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** 大纲 */
  getHeadings() {
    const headings = [];
    this.root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const level = parseInt(h.tagName[1], 10);
      const text = h.textContent;
      let id = h.id;
      if (!id) {
        id = "h-" + Math.random().toString(36).slice(2, 8);
        h.id = id;
      }
      headings.push({ level, text, id });
    });
    return headings;
  }

  /** 在光标处插入 markdown 片段 */
  insertAtCursor(mdText) {
    if (this.editing) {
      this._insertText(mdText);
    } else {
      this.source += (this.source && !this.source.endsWith("\n") ? "\n\n" : "") + mdText;
      this._render();
      this.onChange(this.source, true);
    }
  }
}
