// 新增功能验收测试：脚注/复制菜单/搜索面板/自定义CSS/CSV表格
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

// 含脚注的测试文档
const DOC = `# 测试

正文有脚注[^1]。

[^1]: 这是脚注内容。`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.evaluate((md) => window.__app.editor.setContent(md), DOC);
await page.waitForTimeout(1500);

// 1. 脚注渲染
try {
  const fn = await page.locator("#editor .footnotes").count();
  if (fn >= 1) ok("脚注渲染（.footnotes 区块）");
  else bad("脚注渲染", "无 .footnotes");
} catch (e) { bad("脚注渲染", e.message.slice(0, 80)); }

// 2. 右键菜单 DOM 存在
try {
  const menu = await page.locator("#ctx-menu").count();
  if (menu >= 1) ok("右键复制菜单 DOM 存在");
  else bad("右键复制菜单", "无");
} catch (e) { bad("右键复制菜单", e.message.slice(0, 80)); }

// 3. 复制菜单项数量
try {
  const items = await page.locator("#ctx-menu .ctx-item").count();
  if (items === 3) ok("复制菜单 3 项（HTML/纯文本/源码）");
  else bad("复制菜单项", `仅 ${items} 项`);
} catch (e) { bad("复制菜单项", e.message.slice(0, 80)); }

// 4. 搜索面板 DOM + 快捷键
try {
  // Ctrl+Shift+F 唤起
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("F");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.waitForTimeout(300);
  const panel = await page.locator("#search-panel:not(.hidden)").count();
  if (panel >= 1) ok("Ctrl+Shift+F 唤起搜索面板");
  else bad("搜索面板", "未显示");
} catch (e) { bad("搜索面板", e.message.slice(0, 80)); }

// 5. 搜索输入框存在
try {
  const input = await page.locator("#search-input").count();
  if (input >= 1) ok("搜索输入框存在");
  else bad("搜索输入框", "无");
} catch (e) { bad("搜索输入框", e.message.slice(0, 80)); }

// 关闭搜索面板
await page.click("#search-close");

// 6. 自定义 CSS 弹窗 + 按钮
try {
  await page.click("#btn-customcss");
  await page.waitForTimeout(300);
  const modal = await page.locator("#css-modal:not(.hidden)").count();
  if (modal >= 1) ok("自定义 CSS 弹窗显示");
  else bad("自定义 CSS 弹窗", "未显示");
} catch (e) { bad("自定义 CSS 弹窗", e.message.slice(0, 80)); }

// 7. 应用自定义 CSS 后注入 style 标签
try {
  await page.fill("#css-editor", "#editor h1 { color: #ff0000; }");
  await page.click("#css-apply");
  await page.waitForTimeout(300);
  const style = await page.locator("#custom-css").count();
  if (style >= 1) ok("自定义 CSS 注入 style 标签");
  else bad("自定义 CSS 注入", "无 #custom-css");
} catch (e) { bad("自定义 CSS 注入", e.message.slice(0, 80)); }

// 8. 自定义 CSS 后 h1 颜色生效
try {
  const color = await page.locator("#editor h1").first().evaluate(el => getComputedStyle(el).color);
  if (color.includes("255") || color.includes("ff0000")) ok(`自定义 CSS 生效 (h1 color=${color})`);
  else bad("自定义 CSS 生效", `color=${color}`);
} catch (e) { bad("自定义 CSS 生效", e.message.slice(0, 80)); }

// 9. CSV 转表格逻辑（直接调用方法）
try {
  const result = await page.evaluate(() => {
    return window.__app._csvToMarkdownTable("A\tB\n1\t2\n3\t4");
  });
  if (result && result.includes("| A | B |") && result.includes("| 1 | 2 |") && result.includes("---")) ok("CSV/TSV 转 Markdown 表格逻辑正确");
  else bad("CSV 转表格", result);
} catch (e) { bad("CSV 转表格", e.message.slice(0, 80)); }

// 10. _looksLikeTable 判断
try {
  const isTable = await page.evaluate(() => window.__app._looksLikeTable("A\tB\n1\t2"));
  const notTable = await page.evaluate(() => window.__app._looksLikeTable("普通文本"));
  if (isTable && !notTable) ok("表格文本识别正确");
  else bad("表格文本识别", `isTable=${isTable} notTable=${notTable}`);
} catch (e) { bad("表格文本识别", e.message.slice(0, 80)); }

// 重置自定义 CSS
await page.evaluate(() => localStorage.removeItem("md-customcss"));

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
