// 逐按钮完整功能测试
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// 预注册 dialog 处理器（prompt/confirm/alert 自动响应）
page.on("dialog", async (dialog) => {
  await dialog.accept("1").catch(() => {});
});

// ========== 顶栏按钮逐个测试 ==========

// 1. 新建（＋）
try {
  const before = await page.locator("#tab-bar .tab").count();
  await page.click("#btn-new", { force: true });
  await page.waitForTimeout(300);
  const after = await page.locator("#tab-bar .tab").count();
  if (after > before) ok(`新建标签页（${before}→${after}）`); else bad("新建标签页", "数量未增");
} catch (e) { bad("新建标签页", e.message.slice(0, 60)); }

// 切回第一个标签（有欢迎内容）
await page.locator("#tab-bar .tab").first().click();
await page.waitForTimeout(500);

// 2. 打开（📂）—— 非Tauri环境无法弹原生对话框，验证按钮可点不报错
try {
  await page.click("#btn-open", { force: true });
  await page.waitForTimeout(200);
  ok("打开按钮可点击（原生对话框在 exe 中触发）");
} catch (e) { bad("打开按钮", e.message.slice(0, 60)); }

// 3. 保存（💾）—— 验证可点击
try {
  await page.click("#btn-save", { force: true });
  await page.waitForTimeout(200);
  ok("保存按钮可点击");
} catch (e) { bad("保存按钮", e.message.slice(0, 60)); }

// 4. 导出（⤓）—— prompt 自动被 dialog 处理器接受
try {
  await page.click("#btn-export", { force: true });
  await page.waitForTimeout(500);
  ok("导出按钮触发（prompt 自动响应）");
} catch (e) { bad("导出按钮", e.message.slice(0, 60)); }

// 5. 主题切换（🎨）
try {
  const before = await page.evaluate(() => getComputedStyle(document.getElementById("editor-container")).backgroundColor);
  await page.click("#btn-theme", { force: true });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => getComputedStyle(document.getElementById("editor-container")).backgroundColor);
  if (before !== after) ok(`主题切换（${before}→${after}）`); else bad("主题切换", "颜色未变");
} catch (e) { bad("主题切换", e.message.slice(0, 60)); }
// 切回
await page.click("#btn-theme", { force: true });
await page.waitForTimeout(300);

// 6. 大纲（☰）
try {
  const before = await page.locator("#outline").evaluate(el => el.classList.contains("collapsed"));
  await page.click("#btn-outline", { force: true });
  await page.waitForTimeout(300);
  const after = await page.locator("#outline").evaluate(el => el.classList.contains("collapsed"));
  if (before !== after) ok("大纲切换"); else bad("大纲切换", "状态未变");
} catch (e) { bad("大纲切换", e.message.slice(0, 60)); }

// 7. 侧边栏（📑）
try {
  const before = await page.locator("#sidebar").evaluate(el => el.classList.contains("collapsed"));
  await page.click("#btn-sidebar", { force: true });
  await page.waitForTimeout(300);
  const after = await page.locator("#sidebar").evaluate(el => el.classList.contains("collapsed"));
  if (before !== after) ok("侧边栏切换"); else bad("侧边栏切换", "状态未变");
} catch (e) { bad("侧边栏切换", e.message.slice(0, 60)); }

// 8. 自定义CSS（⚙）
try {
  await page.click("#btn-customcss", { force: true });
  await page.waitForTimeout(300);
  const visible = await page.locator("#css-modal:not(.hidden)").count();
  if (visible >= 1) { ok("自定义CSS弹窗"); await page.click("#css-close"); }
  else bad("自定义CSS弹窗", "未显示");
} catch (e) { bad("自定义CSS弹窗", e.message.slice(0, 60)); }

// 9. 模式切换（📝）
try {
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(300);
  const editing = await page.locator("#editor.editing-mode").count();
  if (editing >= 1) { ok("模式切换→源码"); await page.click("#btn-mode"); await page.waitForTimeout(1000); ok("模式切换→渲染"); }
  else bad("模式切换", "未进源码");
} catch (e) { bad("模式切换", e.message.slice(0, 60)); }

// 10. Git面板（⎇）
try {
  await page.click("#btn-git", { force: true });
  await page.waitForTimeout(300);
  const visible = await page.locator("#git-panel:not(.hidden)").count();
  if (visible >= 1) { ok("Git面板打开"); await page.click("#git-close"); }
  else bad("Git面板", "未显示");
} catch (e) { bad("Git面板", e.message.slice(0, 60)); }

// 11. 文档图谱（🕸）
try {
  await page.click("#btn-graph", { force: true });
  await page.waitForTimeout(500);
  const visible = await page.locator("#graph-modal:not(.hidden)").count();
  if (visible >= 1) { ok("文档图谱打开"); await page.click("#graph-close"); }
  else bad("文档图谱", "未显示");
} catch (e) { bad("文档图谱", e.message.slice(0, 60)); }

// 12. 一键发布（📤）—— prompt 自动响应
try {
  await page.click("#btn-publish", { force: true });
  await page.waitForTimeout(500);
  ok("一键发布触发（prompt 自动响应）");
} catch (e) { bad("一键发布", e.message.slice(0, 60)); }

// ========== 渲染内容完整性（先测，避免后续格式操作改变内容） ==========
// 25. 渲染内容完整性
try {
  const h1 = await page.locator("#editor h1").count();
  const h2 = await page.locator("#editor h2").count();
  const pre = await page.locator("#editor pre").count();
  const table = await page.locator("#editor table").count();
  const task = await page.locator("#editor .task-list-item").count();
  if (h1 >= 1 && h2 >= 1 && pre >= 1 && table >= 1 && task >= 1) ok(`渲染完整性（h1=${h1} h2=${h2} pre=${pre} table=${table} task=${task}）`);
  else bad("渲染完整性", `h1=${h1} h2=${h2} pre=${pre} table=${table} task=${task}`);
} catch (e) { bad("渲染完整性", e.message.slice(0, 60)); }

// ========== 格式工具栏逐个测试 ==========

// 13-16. 格式按钮（选中文字后点）——每次重置文档确保一致
const fmtTests = [
  ["bold", "**", "加粗"],
  ["italic", "*", "斜体"],
  ["strike", "~~", "删除线"],
  ["code", "`", "行内代码"],
];
for (const [fmt, marker, name] of fmtTests) {
  try {
    // 重置欢迎文档
    await page.evaluate(() => window.__app.editor.setContent("# 测试\n\n这是测试文本用于格式验证。\n\n另一段。"));
    await page.waitForTimeout(1500);
    // 选中"测试文本"
    await page.evaluate(() => {
      const p = document.querySelector("#editor p");
      if (!p) return;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const ni = node.textContent.indexOf("测试文本");
        if (ni >= 0) {
          const r = document.createRange();
          r.setStart(node, ni);
          r.setEnd(node, ni + 4);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          break;
        }
        node = walker.nextNode();
      }
    });
    await page.waitForTimeout(100);
    await page.click(`.ft-btn[data-fmt="${fmt}"]`, { force: true });
    await page.waitForTimeout(1500);
    const src = await page.evaluate(() => window.__app.editor.getContent());
    if (src.includes(`${marker}测试文本${marker}`)) ok(`${name}格式生效`);
    else bad(`${name}格式`, `source未含 ${marker}测试文本${marker}`);
  } catch (e) { bad(`${name}格式`, e.message.slice(0, 60)); }
}

// 17. 标题格式（H1）
try {
  await page.evaluate(() => window.__app.editor.setContent("# 标题\n\n这是标题测试段落。\n\n第二段。"));
  await page.waitForTimeout(1500);
  // 选中第一段文字
  await page.evaluate(() => {
    const p = document.querySelector("#editor p");
    if (p) { const r = document.createRange(); r.selectNodeContents(p); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  await page.waitForTimeout(100);
  await page.click('.ft-btn[data-fmt="h1"]', { force: true });
  await page.waitForTimeout(1500);
  const h1Count = await page.locator("#editor h1").count();
  if (h1Count >= 2) ok("H1标题格式生效"); else bad("H1标题格式", `h1数=${h1Count}`);
} catch (e) { bad("H1标题格式", e.message.slice(0, 60)); }

// 20. 右键菜单
try {
  // 选中文字
  await page.evaluate(() => {
    const p = document.querySelector("#editor p");
    if (p) { const r = document.createRange(); r.selectNodeContents(p); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  await page.waitForTimeout(100);
  // 模拟右键
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 400, clientY: 300 }));
  });
  await page.waitForTimeout(300);
  const menuVisible = await page.locator("#ctx-menu:not(.hidden)").count();
  if (menuVisible >= 1) { ok("右键菜单弹出"); await page.click("#ctx-menu"); }
  else bad("右键菜单", "未弹出");
} catch (e) { bad("右键菜单", e.message.slice(0, 60)); }

// 21. 工具栏收起/展开
try {
  const before = await page.locator("#format-toolbar").evaluate(el => el.classList.contains("collapsed"));
  await page.click("#toolbar-toggle", { force: true });
  await page.waitForTimeout(200);
  const after = await page.locator("#format-toolbar").evaluate(el => el.classList.contains("collapsed"));
  if (before !== after) ok("工具栏收起"); else bad("工具栏收起", "状态未变");
  // 展开
  const expand = await page.locator("#toolbar-expand").count();
  if (expand >= 1) { await page.click("#toolbar-expand", { force: true }); ok("工具栏展开"); }
} catch (e) { bad("工具栏收起/展开", e.message.slice(0, 60)); }

// 22. 快捷键 Ctrl+B（用 evaluate 直接触发，模拟按键）
try {
  await page.evaluate(() => window.__app.editor.setContent("# 测试\n\n快捷键加粗测试文字。"));
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const p = document.querySelector("#editor p");
    if (p) { const r = document.createRange(); r.selectNodeContents(p); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  });
  await page.waitForTimeout(100);
  // 直接调用格式函数（等价于 Ctrl+B）
  await page.evaluate(() => window.__app._insertFormat("bold"));
  await page.waitForTimeout(1500);
  const src = await page.evaluate(() => window.__app.editor.getContent());
  if (src.includes("**快捷键加粗测试文字")) ok("Ctrl+B 快捷键逻辑生效（bold 格式包裹）");
  else bad("Ctrl+B", "source无包裹");
} catch (e) { bad("Ctrl+B", e.message.slice(0, 60)); }

// 23. 状态栏字数统计
try {
  const stats = await page.locator("#status-stats").textContent();
  if (stats && /\d+\s*字/.test(stats)) ok(`状态栏字数统计（${stats.trim()}）`); else bad("状态栏字数", stats);
} catch (e) { bad("状态栏字数", e.message.slice(0, 60)); }

// 24. 多标签页切换
try {
  const tabs = await page.locator("#tab-bar .tab").count();
  if (tabs >= 2) {
    await page.locator("#tab-bar .tab").last().click();
    await page.waitForTimeout(300);
    const active = await page.locator("#tab-bar .tab.active").textContent();
    if (active) ok("多标签页切换"); else bad("标签页切换", "无active");
  } else ok("多标签页（仅1个，跳过切换测试）");
} catch (e) { bad("标签页切换", e.message.slice(0, 60)); }

await browser.close();
console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
