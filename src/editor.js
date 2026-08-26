// 即时渲染编辑器（Typora 风格）
//
// 模型：source 字符串是唯一真相。DOM 是渲染视图，由"块"组成。
// 每个顶级 DOM 块（.md-block）带 data-raw = 对应的 markdown 源码片段。
// 交互：点击某块 → 该块进入"源码态"（显示 raw，可编辑）；
//       离开该块（点击别处/失焦）→ 重新渲染，光标移到相邻块。
// 整体源码始终由所有块的 raw 拼接得到，保证保存/导出一致。

import { parseMarkdown } from "./markdown.js";
import { postRender } from "./postrender.js";

const SPLIT_RE = /\n{2,}/;

export class Editor {
  constructor(rootEl, onChange, onHeadingsChange) {
    this.root = rootEl;
    this.onChange = onChange || (() => {});
    this.onHeadingsChange = onHeadingsChange || (() => {});
    this.source = "";
    this.blocks = []; // [{ raw: string }]
    this.editingIndex = -1;
    this.suppress = false;

    this._bind();
  }

  _bind() {
    this.root.addEventListener("click", (e) => this._onClick(e));
    this.root.addEventListener("input", (e) => this._onInput(e));
    this.root.addEventListener("keydown", (e) => this._onKeydown(e));
    this.root.addEventListener("focusout", () => this.commitEditing(), true);
  }

  /** 设置内容 */
  setContent(md) {
    this.source = md || "";
    this.editingIndex = -1;
    this._rebuildBlocks();
    this._render();
    this.onChange(this.source, false);
  }

  getContent() {
    return this.source;
  }

  /** 按双空行切分源码为块（保护 fenced code 内部空行） */
  _rebuildBlocks() {
    const raw = this.source;
    if (!raw.trim()) {
      this.blocks = [{ raw: "" }];
      return;
    }
    // 保护代码块
    const guards = [];
    const protected_ = raw.replace(/```[\s\S]*?```/g, (m) => {
      const i = guards.length;
      guards.push(m);
      return `\u0000${i}\u0000`;
    });
    let parts = protected_.split(SPLIT_RE).map((p) => p.trim()).filter((p) => p.length);
    // 还原代码块
    parts = parts.map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, i) => guards[+i]));
    this.blocks = parts.map((raw) => ({ raw }));
  }

  /** 把块源码同步回 source */
  _syncSource() {
    this.source = this.blocks.map((b) => b.raw).join("\n\n");
  }

  /** 整体渲染所有块 */
  _render() {
    this.suppress = true;
    this.root.innerHTML = "";
    this.blocks.forEach((block, i) => {
      const el = this._renderBlock(block, i);
      this.root.appendChild(el);
    });
    // 后渲染（数学、mermaid）异步
    postRender(this.root).finally(() => {
      this.suppress = false;
      this.onHeadingsChange(this.getHeadings());
    });
  }

  /** 渲染单个块为 DOM 元素 */
  _renderBlock(block, i) {
    const el = document.createElement("div");
    el.className = "md-block";
    el.dataset.index = String(i);
    el.dataset.raw = block.raw;
    // 空块
    if (!block.raw.trim()) {
      el.innerHTML = "<p><br></p>";
      return el;
    }
    el.innerHTML = parseMarkdown(block.raw);
    return el;
  }

  /** 点击：进入或移动编辑块 */
  _onClick(e) {
    const blockEl = e.target.closest(".md-block");
    if (!blockEl) return;
    const idx = parseInt(blockEl.dataset.index, 10);
    if (idx === this.editingIndex) return;
    // 提交当前编辑块，再进入新块
    this.commitEditing();
    this._enterEdit(idx, e);
  }

  /** 进入编辑态 */
  _enterEdit(idx, evt) {
    if (idx < 0 || idx >= this.blocks.length) return;
    this.editingIndex = idx;
    const oldEl = this.root.querySelector(`.md-block[data-index="${idx}"]`);
    if (!oldEl) return;
    const raw = this.blocks[idx].raw;
    const el = document.createElement("div");
    el.className = "md-block editing";
    el.dataset.index = String(idx);
    el.contentEditable = "true";
    el.spellcheck = false;
    el.textContent = raw;
    oldEl.replaceWith(el);
    this._placeCursor(el, evt);
    el.focus();
  }

  /** 提交编辑块：把 DOM 文本写回 block.raw，重新渲染 */
  commitEditing() {
    if (this.editingIndex < 0) return;
    const idx = this.editingIndex;
    const el = this.root.querySelector(`.md-block[data-index="${idx}"]`);
    if (el) {
      const raw = el.textContent;
      // 如果块变空，删除
      if (!raw.trim() && this.blocks.length > 1) {
        this.blocks.splice(idx, 1);
      } else {
        this.blocks[idx].raw = raw;
      }
    }
    this.editingIndex = -1;
    this._syncSource();
    this._render();
    this.onChange(this.source, false);
  }

  /** 编辑态输入：同步到 block.raw 与 source */
  _onInput(e) {
    if (this.editingIndex < 0 || this.suppress) return;
    const el = this.root.querySelector(`.md-block.editing`);
    if (!el) return;
    const idx = parseInt(el.dataset.index, 10);
    if (idx !== this.editingIndex) return;
    const raw = el.textContent;
    this.blocks[idx].raw = raw;
    this._syncSource();
    this.onChange(this.source, true);
  }

  /** 键盘处理 */
  _onKeydown(e) {
    if (this.editingIndex < 0) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._splitBlock();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this._insertText("  ");
      return;
    }
    if (e.key === "Backspace") {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed) {
        const el = this.root.querySelector(`.md-block.editing`);
        if (el && el.textContent === "") {
          e.preventDefault();
          this._mergeWithPrev();
          return;
        }
      }
    }
  }

  /** 回车：在光标处拆分当前块 */
  _splitBlock() {
    const el = this.root.querySelector(".md-block.editing");
    if (!el) return;
    const idx = parseInt(el.dataset.index, 10);
    const sel = window.getSelection();
    let pos = el.textContent.length;
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      pos = this._cursorOffset(el, range);
    }
    const text = el.textContent;
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    this.blocks[idx].raw = before;
    this.blocks.splice(idx + 1, 0, { raw: after });
    this._syncSource();
    this.editingIndex = -1;
    this._render();
    // 进入新块
    requestAnimationFrame(() => this._enterEdit(idx + 1));
    this.onChange(this.source, true);
  }

  /** 与前一块合并 */
  _mergeWithPrev() {
    const el = this.root.querySelector(".md-block.editing");
    if (!el) return;
    const idx = parseInt(el.dataset.index, 10);
    if (idx === 0) return;
    const prev = this.blocks[idx - 1];
    const cur = this.blocks[idx].raw;
    prev.raw = prev.raw + cur;
    this.blocks.splice(idx, 1);
    this._syncSource();
    this.editingIndex = -1;
    this._render();
    requestAnimationFrame(() => this._enterEdit(idx - 1));
    this.onChange(this.source, true);
  }

  /** 插入文本 */
  _insertText(text) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const el = this.root.querySelector(".md-block.editing");
    if (el) {
      const idx = parseInt(el.dataset.index, 10);
      this.blocks[idx].raw = el.textContent;
      this._syncSource();
      this.onChange(this.source, true);
    }
  }

  /** 光标偏移 */
  _cursorOffset(el, range) {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  /** 放置光标：点击则到点击位置，否则到末尾 */
  _placeCursor(el, evt) {
    const sel = window.getSelection();
    const range = document.createRange();
    // 尝试放到点击处
    if (evt && evt.target !== el && evt.target.nodeType === Node.TEXT_NODE) {
      try {
        range.selectNodeContents(el);
        range.setStart(evt.target, Math.min(evt.offset || 0, evt.target.length || 0));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      } catch {
        /* fallthrough */
      }
    }
    range.selectNodeContents(el);
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
    if (this.editingIndex >= 0) {
      this._insertText(mdText);
    } else {
      this.source += (this.source && !this.source.endsWith("\n") ? "\n\n" : this.source ? "\n" : "") + mdText;
      this._rebuildBlocks();
      this._render();
      this.onChange(this.source, true);
    }
  }
}
