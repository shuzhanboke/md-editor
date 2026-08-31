// 即时渲染编辑器（Typora 式块级就地编辑）
//
// 渲染态：contenteditable=true，显示渲染结果
// 点击某块 → 该块变为源码态（仅该块），其余保持渲染
// 离开该块（点击别处/Tab/Esc）→ 该块重新渲染
// 格式按钮：选中文字后直接在 source 层面包裹标记
// 手动全文源码模式：toggleSourceMode()

import { parseMarkdown } from "./markdown.js";
import { postRender } from "./postrender.js";

export class Editor {
  constructor(rootEl, onChange, onHeadingsChange) {
    this.root = rootEl;
    this.onChange = onChange || (() => {});
    this.onHeadingsChange = onHeadingsChange || (() => {});
    this.source = "";
    this.editing = false; // 全文源码模式
    this.editingBlock = null; // 当前块级编辑的元素
    this.suppress = false;
    this.vimMode = "normal";

    this._bind();
  }

  _bind() {
    this.root.addEventListener("click", (e) => this._onClick(e));
    this.root.addEventListener("input", (e) => this._onInput(e));
    this.root.addEventListener("keydown", (e) => this._onKeydown(e));
    this.root.addEventListener("blur", () => this.commitBlockEdit(), true);
  }

  /** 设置内容 */
  setContent(md) {
    this.source = md || "";
    this.editing = false;
    this.editingBlock = null;
    this._render();
    this.onChange(this.source, false);
  }

  getContent() {
    return this.source;
  }

  /** 整体渲染 */
  _render() {
    this.suppress = true;
    this.editingBlock = null;
    this.root.contentEditable = "true";
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

  /** 点击：进入或移动块级编辑 */
  _onClick(e) {
    if (this.editing) return; // 全文源码模式不处理
    const block = e.target.closest("h1,h2,h3,h4,h5,h6,p,pre,blockquote,ul,ol,table,hr,div.mermaid-container,div.math-block");
    if (!block || !this.root.contains(block)) return;
    // 已在编辑此块则不处理
    if (block === this.editingBlock) return;
    // 提交之前的块
    if (this.editingBlock) this.commitBlockEdit();
    this._enterBlockEdit(block);
  }

  /** 进入单块编辑：该块显示源码 */
  _enterBlockEdit(block) {
    const raw = this._findBlockSource(block);
    if (raw === null) return;
    this.editingBlock = block;
    block.dataset.raw = raw;
    block.classList.add("block-editing");
    block.setAttribute("contenteditable", "true");
    block.textContent = raw;
    block.focus();
    // 光标到末尾
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** 提交块编辑：把块源码写回 source，重渲染该块 */
  commitBlockEdit() {
    if (!this.editingBlock || this.editing) return;
    const block = this.editingBlock;
    const raw = block.textContent;
    const oldRaw = block.dataset.raw || "";
    block.classList.remove("block-editing");
    block.removeAttribute("contenteditable");
    this.editingBlock = null;
    if (raw !== oldRaw) {
      // 更新 source 中对应块
      this._updateBlockSource(oldRaw, raw);
      // 重新渲染整体（确保格式正确）
      this._render();
      this.onChange(this.source, true);
    }
  }

  /** 在 source 中找到块对应的源码片段 */
  _findBlockSource(block) {
    const text = block.textContent;
    // 在 source 中查找包含该块文本的行段
    // 简化：按块在 DOM 中的顺序找 source 的对应段
    const blocks = Array.from(this.root.children);
    const idx = blocks.indexOf(block);
    const parts = this._splitSource(this.source);
    if (idx >= 0 && idx < parts.length) return parts[idx];
    // 回退：在 source 中找文本匹配
    const lines = this.source.split("\n");
    for (const line of lines) {
      if (line.includes(text.slice(0, 10))) return line;
    }
    return text;
  }

  /** 按 markdown 块切分 source（保护代码块内空行） */
  _splitSource(md) {
    if (!md) return [""];
    const guards = [];
    let text = md.replace(/```[\s\S]*?```/g, (m) => {
      const i = guards.length;
      guards.push(m);
      return `\u0000${i}\u0000`;
    });
    let parts = text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length);
    parts = parts.map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, i) => guards[+i]));
    return parts.length ? parts : [""];
  }

  /** 更新 source 中某块 */
  _updateBlockSource(oldRaw, newRaw) {
    const parts = this._splitSource(this.source);
    const idx = parts.indexOf(oldRaw);
    if (idx >= 0) {
      parts[idx] = newRaw;
    } else {
      parts.push(newRaw);
    }
    this.source = parts.join("\n\n");
  }

  /** 切换全文源码/渲染模式 */
  toggleSourceMode() {
    if (this.editing) {
      // 源码 → 渲染
      this.source = this.root.textContent;
      this.editing = false;
      this._vimStatus(null);
      this._render();
      this.onChange(this.source, false);
    } else {
      // 提交块编辑
      if (this.editingBlock) this.commitBlockEdit();
      // 渲染 → 源码
      this.editing = true;
      this.vimMode = "normal";
      this.root.innerHTML = "";
      this.root.textContent = this.source;
      this.root.classList.add("editing-mode");
      this.root.focus();
      const range = document.createRange();
      range.selectNodeContents(this.root);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      this.onChange(this.source, true);
    }
  }

  /** 跳转到源码第 N 行并高亮定位
   *  渲染模式下自动切到源码模式；在源码文本节点中按行偏移定位光标，
   *  临时高亮该行背景并滚动到视口中央。
   */
  goToLine(line) {
    if (this.editingBlock) this.commitBlockEdit();
    // 确保处于全文源码模式（便于按行号精确定位）
    if (!this.editing) this.toggleSourceMode();

    const lines = this.source.split("\n");
    const targetLine = Math.max(1, Math.min(line | 0, lines.length));

    // 计算目标行起始字符偏移（前面所有行长度 + 换行符）
    let offset = 0;
    for (let i = 0; i < targetLine - 1; i++) {
      offset += lines[i].length + 1; // +1 for \n
    }
    const lineEnd = offset + (lines[targetLine - 1] || "").length;

    const textNode = this.root.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      this.root.focus();
      return;
    }
    // 选中该行（行首→行尾），便于用户看到定位
    const range = document.createRange();
    range.setStart(textNode, Math.min(offset, textNode.length));
    range.setEnd(textNode, Math.min(lineEnd, textNode.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this.root.focus();

    // 临时高亮当前行：用 selection 的临时标记
    // 滚动到视口中央
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // 行可能不可见，用 root 的 scrollTop 估算
      this.root.scrollTop = Math.max(0, (targetLine - 1) * 22);
    } else {
      const rootRect = this.root.getBoundingClientRect();
      this.root.scrollTop += rect.top - rootRect.top - rootRect.height / 2 + rect.height / 2;
    }
  }

  /** 渲染模式：选中文字应用包裹格式（在 source 层面操作） */
  applyWrapFormat(before, after) {
    if (this.editing) return; // 全文源码模式由 main.js 处理
    // 先保存选中文本（提交块编辑会丢失选区）
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount ? sel.toString() : "";
    // 提交块编辑，确保 source 是干净的最新值
    if (this.editingBlock) this.commitBlockEdit();
    if (!selectedText) {
      this.source += "\n" + before + "文本" + after;
      this._render();
      this.onChange(this.source, true);
      return;
    }
    const idx = this.source.indexOf(selectedText);
    if (idx >= 0) {
      this.source = this.source.slice(0, idx) + before + selectedText + after + this.source.slice(idx + selectedText.length);
    } else {
      this.source += "\n" + before + selectedText + after;
    }
    this._render();
    this.onChange(this.source, true);
  }

  /** 渲染模式：行首格式 */
  applyLineFormat(prefix) {
    if (this.editing) return;
    // 先保存选中文本
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount ? sel.toString() : "";
    // 提交块编辑
    if (this.editingBlock) this.commitBlockEdit();
    if (!selectedText) {
      this.source += "\n" + prefix + "文本";
      this._render();
      this.onChange(this.source, true);
      return;
    }
    const idx = this.source.indexOf(selectedText);
    if (idx >= 0) {
      const before = this.source.slice(0, idx);
      const lineStart = before.lastIndexOf("\n") + 1;
      this.source = this.source.slice(0, lineStart) + prefix + this.source.slice(lineStart);
    } else {
      this.source += "\n" + prefix + selectedText;
    }
    if (this.editingBlock) this.commitBlockEdit();
    this._render();
    this.onChange(this.source, true);
  }

  /** 插入片段 */
  insertSnippet(snippet) {
    if (this.editing) {
      this._insertAtCursor(snippet);
    } else {
      if (this.editingBlock) this.commitBlockEdit();
      this.source += (this.source && !this.source.endsWith("\n") ? "\n" : "") + snippet;
      this._render();
      this.onChange(this.source, true);
    }
  }

  insertAtCursor(mdText) {
    if (this.editing) {
      this._insertAtCursor(mdText);
    } else {
      this.insertSnippet(mdText);
    }
  }

  /** 源码模式下在光标处插入 */
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

  /** 输入处理 */
  _onInput(e) {
    if (this.suppress) return;
    if (this.editing) {
      // 全文源码模式
      this.source = this.root.textContent;
      this.onChange(this.source, true);
    } else if (this.editingBlock) {
      // 块级编辑：实时更新 source 中的对应块
      const block = this.editingBlock;
      const oldRaw = block.dataset.raw || "";
      const newRaw = block.textContent;
      block.dataset.raw = newRaw;
      // 实时把块的新内容写回 source
      this._updateBlockSource(oldRaw, newRaw);
      this.onChange(this.source, true);
    }
  }

  /** 键盘处理 */
  _onKeydown(e) {
    if (this.editing) {
      // 全文源码模式
      if (e.key === "Escape") {
        e.preventDefault();
        this.toggleSourceMode();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        this._insertAtCursor("  ");
        return;
      }
      return;
    }
    // 块级编辑模式
    if (this.editingBlock) {
      const block = this.editingBlock;
      // Tab 缩进
      if (e.key === "Tab") {
        e.preventDefault();
        document.execCommand("insertText", false, "  ");
        return;
      }
      // Esc 提交块
      if (e.key === "Escape") {
        e.preventDefault();
        this.commitBlockEdit();
        return;
      }
      // Enter：在块内换行（不拆分块，除非列表则续行）
      // 默认允许换行（shift+Enter 语义），普通 Enter 也换行
      return;
    }
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
}
