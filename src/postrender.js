// 后渲染：对解析后的 DOM 块做数学公式、Mermaid 渲染
import katex from "katex";
import mermaid from "mermaid";
import { extractInlineMath, restoreInlineMath } from "./markdown.js";

export { extractInlineMath, restoreInlineMath };

let mermaidInited = false;
let mermaidCounter = 0;

function initMermaid() {
  if (mermaidInited) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    securityLevel: "loose",
    fontFamily: "inherit",
  });
  mermaidInited = true;
}

/** 重新初始化 mermaid（主题切换后） */
export function reinitMermaid() {
  mermaidInited = false;
}

/** 渲染容器内所有 math / mermaid 占位 */
export async function postRender(root) {
  if (!root) return;

  // 数学公式（行内 + 块级）
  const mathEls = root.querySelectorAll("[data-math]");
  for (const el of mathEls) {
    try {
      const tex = decodeAttr(el.getAttribute("data-math"));
      const displayMode = el.classList.contains("math-block");
      const html = katex.renderToString(tex, { displayMode, throwOnError: false });
      if (displayMode) {
        el.innerHTML = html;
      } else {
        el.outerHTML = html;
      }
    } catch {
      el.textContent = el.getAttribute("data-math") || "";
    }
  }

  // Mermaid
  const mermaidEls = root.querySelectorAll(".mermaid-container[data-mermaid]");
  if (mermaidEls.length > 0) {
    initMermaid();
    for (const el of mermaidEls) {
      if (el.dataset.rendered) continue;
      const graphDef = decodeAttr(el.getAttribute("data-mermaid"));
      const id = `mmd-${Date.now()}-${mermaidCounter++}`;
      try {
        const { svg } = await mermaid.render(id, graphDef);
        el.innerHTML = svg;
        el.dataset.rendered = "1";
      } catch {
        el.textContent = graphDef;
        el.style.color = "#c00";
      }
    }
  }
}

function decodeAttr(s) {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
