// Markdown 解析与即时渲染
// 基于 marked v14，扩展：代码高亮、Mermaid、数学公式占位、任务列表

import { marked } from "marked";
import hljs from "highlight.js";

const renderer = new marked.Renderer();

// 代码块：高亮 + Mermaid + 数学
renderer.code = function ({ text, lang }) {
  if (lang === "mermaid") {
    return `<div class="mermaid-container" data-mermaid="${escapeAttr(text)}"></div>`;
  }
  if (lang === "math") {
    return `<div class="math-block" data-math="${escapeAttr(text)}"></div>`;
  }
  let highlighted;
  if (lang && hljs.getLanguage(lang)) {
    try {
      highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  } else {
    try {
      highlighted = hljs.highlightAuto(text).value;
    } catch {
      highlighted = escapeHtml(text);
    }
  }
  const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : "";
  return `<pre><code class="hljs language-${escapeAttr(lang || "")}">${highlighted}</code>${langLabel}</pre>`;
};

// 行内代码
renderer.codespan = function ({ text }) {
  return `<code>${escapeHtml(text)}</code>`;
};

// 链接
renderer.link = function ({ href, title, tokens }) {
  const text = this.parser.parseInline(tokens);
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<a href="${escapeAttr(href)}"${titleAttr} target="_blank" rel="noopener">${text}</a>`;
};

// 任务列表项：用 parse（非 parseInline）处理可能含嵌套列表的 tokens
renderer.listitem = function (item) {
  // marked v14 的 tokens 可能含 list/text 等块级 token，用 parse 处理
  let text = "";
  if (item.tokens) {
    text = this.parser.parse(item.tokens);
  } else if (item.text) {
    text = escapeHtml(item.text);
  }
  if (item.task) {
    const checked = item.checked ? "checked" : "";
    return `<li class="task-list-item"><input type="checkbox" ${checked} disabled><span>${text}</span></li>`;
  }
  return `<li>${text}</li>`;
};

// 列表：标记 contains-task-list
renderer.list = function (item) {
  const hasTask = item.items && item.items.some((it) => it.task);
  const tag = item.ordered ? "ol" : "ul";
  const start = item.ordered && item.start && item.start > 1 ? ` start="${item.start}"` : "";
  const taskClass = hasTask ? " contains-task-list" : "";
  let body = "";
  for (const it of item.items) {
    body += this.listitem(it);
  }
  return `<${tag}${start} class="${taskClass.trim()}">${body}</${tag}>`;
};

// 图片
renderer.image = function ({ href, title, text }) {
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}"${titleAttr} />`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

/** 解析 markdown 为 HTML（数学占位由 postrender 还原） */
export function parseMarkdown(md) {
  const { text, placeholders } = extractInlineMath(md);
  let html = marked(text);
  html = restoreInlineMath(html, placeholders);
  return html;
}

/** 行内数学提取/还原（与 postrender 共用） */
function extractInlineMath(text) {
  const placeholders = [];
  // 块级 $$...$$ 转成 ```math 围栏块，由 renderer.code 的 lang=math 分支处理
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    return `\n\n\`\`\`math\n${tex.trim()}\n\`\`\`\n\n`;
  });
  // 行内 $...$ 提取为占位
  text = text.replace(/(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g, (_, tex) => {
    placeholders.push({ type: "inline", tex });
    return `§MATH${placeholders.length - 1}§`;
  });
  return { text, placeholders };
}

function restoreInlineMath(html, placeholders) {
  return html.replace(/§MATH(\d+)§/g, (_, i) => {
    const item = placeholders[+i];
    if (!item) return "";
    // 行内数学延迟到 postrender 用 katex 渲染，这里保留占位
    return `<span class="math-inline" data-math="${escapeAttr(item.tex)}"></span>`;
  });
}

export { extractInlineMath, restoreInlineMath };

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export { escapeHtml, escapeAttr };

/** 创建渲染器实例（兼容旧接口） */
export function createRenderer() {
  return parseMarkdown;
}
