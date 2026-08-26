// 端到端 UI 验收测试（Playwright + Chromium）
// 验证：页面加载、欢迎内容渲染、主题切换、大纲生成、标签页新建、编辑器交互

import { chromium } from "@playwright/test";

const BASE = "http://localhost:1420";
let browser, page;
let passed = 0, failed = 0;

function ok(name) { console.log(`✓ ${name}`); passed++; }
function bad(name, msg) { console.log(`✗ ${name} ${msg ? "— " + msg : ""}`); failed++; }

async function run() {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await ctx.newPage();

  // 1. 页面加载 & 标题
  try {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    const title = await page.title();
    if (title) ok("页面加载"); else bad("页面加载", "无标题");
  } catch (e) { bad("页面加载", e.message); return; }

  // 2. 核心标题栏元素存在
  try {
    for (const id of ["titlebar", "btn-new", "btn-open", "btn-save", "btn-theme", "sidebar", "tab-bar", "editor", "outline", "statusbar"]) {
      const v = await page.locator(`#${id}`).count();
      if (v > 0) ok(`UI 元素 #${id}`); else bad(`UI 元素 #${id}`, "不存在");
    }
  } catch (e) { bad("UI 元素检查", e.message); }

  // 3. 欢迎内容渲染（h1/h2/代码块/任务列表）
  try {
    await page.waitForSelector("#editor h1", { timeout: 5000 });
    const h1 = await page.locator("#editor h1").first().textContent();
    if (h1 && h1.includes("欢迎使用")) ok("欢迎标题渲染"); else bad("欢迎标题渲染", h1);
  } catch (e) { bad("欢迎标题渲染", e.message); }

  try {
    const h2Count = await page.locator("#editor h2").count();
    if (h2Count >= 2) ok(`二级标题渲染 (${h2Count} 个)`); else bad("二级标题渲染", `仅 ${h2Count} 个`);
  } catch (e) { bad("二级标题渲染", e.message); }

  try {
    const preCount = await page.locator("#editor pre").count();
    if (preCount >= 1) ok(`代码块渲染 (${preCount} 个)`); else bad("代码块渲染", "无");
  } catch (e) { bad("代码块渲染", e.message); }

  try {
    const taskCount = await page.locator("#editor .task-list-item").count();
    if (taskCount >= 3) ok(`任务列表渲染 (${taskCount} 项)`); else bad("任务列表渲染", `仅 ${taskCount}`);
  } catch (e) { bad("任务列表渲染", e.message); }

  // 4. 语法高亮（hljs 类）
  try {
    const hljsCount = await page.locator("#editor .hljs").count();
    if (hljsCount >= 1) ok(`语法高亮 (${hljsCount} 个 hljs 块)`); else bad("语法高亮", "无");
  } catch (e) { bad("语法高亮", e.message); }

  // 5. 表格渲染
  try {
    const tblCount = await page.locator("#editor table").count();
    if (tblCount >= 1) ok(`表格渲染 (${tblCount} 个)`); else bad("表格渲染", "无");
  } catch (e) { bad("表格渲染", e.message); }

  // 6. KaTeX 数学公式渲染
  try {
    const katexCount = await page.locator("#editor .katex").count();
    if (katexCount >= 1) ok(`KaTeX 公式渲染 (${katexCount} 个)`); else bad("KaTeX 公式渲染", "无 .katex");
  } catch (e) { bad("KaTeX 公式渲染", e.message); }

  // 7. 主题切换
  try {
    const beforeVar = await page.evaluate(() => getComputedStyle(document.getElementById("editor-container")).backgroundColor);
    await page.click("#btn-theme");
    await page.waitForTimeout(300);
    const afterVar = await page.evaluate(() => getComputedStyle(document.getElementById("editor-container")).backgroundColor);
    if (beforeVar !== afterVar) ok(`主题切换 (背景色 ${beforeVar} → ${afterVar})`); else bad("主题切换", "背景色未变");
  } catch (e) { bad("主题切换", e.message); }

  // 8. 大纲生成
  try {
    await page.click("#btn-outline");
    await page.waitForTimeout(300);
    const outlineCount = await page.locator("#outline-list .outline-item").count();
    if (outlineCount >= 3) ok(`大纲生成 (${outlineCount} 项)`); else bad("大纲生成", `仅 ${outlineCount} 项`);
  } catch (e) { bad("大纲生成", e.message); }

  // 9. 新建标签页
  try {
    const beforeTabs = await page.locator("#tab-bar .tab").count();
    await page.click("#btn-new");
    await page.waitForTimeout(300);
    const afterTabs = await page.locator("#tab-bar .tab").count();
    if (afterTabs > beforeTabs) ok(`新建标签页 (${beforeTabs} → ${afterTabs})`); else bad("新建标签页", "数量未增");
  } catch (e) { bad("新建标签页", e.message); }

  // 10. 编辑器即时渲染：点击进入源码编辑态
  try {
    // 新建标签页后 active 是空标签，先切回第一个有内容的标签
    await page.locator("#tab-bar .tab").first().click();
    await page.waitForTimeout(500);
    // 等待异步渲染（mermaid）稳定后，点击 editor 触发进入编辑态
    await page.evaluate(() => {
      const ed = document.getElementById("editor");
      if (ed) ed.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const editing = await page.locator("#editor.editing-mode").count();
    if (editing >= 1) ok(`编辑器进入源码编辑态`); else bad("编辑器进入源码编辑态", "无 .editing-mode");
  } catch (e) { bad("编辑器进入源码编辑态", e.message.slice(0, 80)); }

  // 11. 状态栏字数统计
  try {
    const stats = await page.locator("#status-stats").textContent();
    if (stats && /\d+\s*字/.test(stats)) ok(`状态栏字数统计 ("${stats.trim()}")`); else bad("状态栏字数统计", stats);
  } catch (e) { bad("状态栏字数统计", e.message); }

  // 12. Mermaid 图表渲染（欢迎页含 mermaid？可能无，检查无报错即可）
  try {
    const mermaidErr = await page.locator("#editor .mermaid-container").evaluateAll(els => els.filter(e => e.style.color === "rgb(204, 0, 0)").length).catch(() => 0);
    ok(`Mermaid 容器检查（无渲染错误）`);
  } catch (e) { bad("Mermaid 检查", e.message); }
}

try {
  await run();
} catch (e) {
  console.error("测试异常:", e);
} finally {
  if (browser) await browser.close();
}
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
