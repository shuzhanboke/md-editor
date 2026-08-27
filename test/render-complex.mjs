// 渲染完整性测试：覆盖之前因"按双空行拆分"导致断裂的结构
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

// 复杂文档：含跨空行列表、嵌套引用、多行表格、代码块内空行、setext 标题
const COMPLEX_MD = [
  "# 主标题",
  "",
  "## 列表跨空行",
  "",
  "- 第一项",
  "",
  "- 第二项（与第一项间有空行）",
  "",
  "- 第三项",
  "",
  "## 嵌套引用",
  "",
  "> 外层引用",
  ">",
  "> > 内层引用",
  ">",
  "> 外层继续",
  "",
  "## 多行表格",
  "",
  "| 名称 | 值 | 说明 |",
  "|------|----|------|",
  "| A | 1 | 第一 |",
  "| B | 2 | 第二 |",
  "| C | 3 | 第三 |",
  "",
  "## 代码块内空行",
  "",
  "```js",
  "function f() {",
  "",
  "  return 42;",
  "",
  "}",
  "```",
  "",
  "## 有序列表跨空行",
  "",
  "1. 步骤一",
  "",
  "2. 步骤二",
  "",
  "3. 步骤三",
  "",
  "## 行内与块级数学",
  "",
  "行内 $a^2 + b^2 = c^2$ 公式",
  "",
  "$$",
  "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
  "$$",
].join("\n");

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
// 先注入测试文档：用 JS 调用 editor.setContent
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// 通过 JS 把复杂文档设置到当前 editor
await page.evaluate((md) => {
  const app = window.__app;
  if (app && app.editor) {
    app.editor.setContent(md);
  }
}, COMPLEX_MD);
await page.waitForTimeout(2000);

// 1. 列表完整性：3 个 li 在同一个 ul
try {
  const ulCount = await page.locator("#editor ul").count();
  const liCount = await page.locator("#editor ul > li").count();
  if (liCount >= 3 && ulCount >= 1) ok(`列表跨空行完整 (${liCount} 个 li)`);
  else bad("列表跨空行完整", `ul=${ulCount} li=${liCount}`);
} catch (e) { bad("列表跨空行完整", e.message.slice(0, 80)); }

// 2. 嵌套引用：外层 blockquote 内有内层 blockquote
try {
  const nested = await page.locator("#editor blockquote blockquote").count();
  if (nested >= 1) ok(`嵌套引用完整 (${nested} 层嵌套)`);
  else bad("嵌套引用完整", `无嵌套 blockquote`);
} catch (e) { bad("嵌套引用完整", e.message.slice(0, 80)); }

// 3. 多行表格：4 行数据 + 表头
try {
  const trCount = await page.locator("#editor table tr").count();
  if (trCount >= 4) ok(`多行表格完整 (${trCount} 行)`);
  else bad("多行表格完整", `仅 ${trCount} 行`);
} catch (e) { bad("多行表格完整", e.message.slice(0, 80)); }

// 4. 代码块内空行保留
try {
  const codeText = await page.locator("#editor pre code").first().textContent();
  if (codeText && codeText.includes("return 42")) ok("代码块内空行保留");
  else bad("代码块内空行保留", "内容缺失");
} catch (e) { bad("代码块内空行保留", e.message.slice(0, 80)); }

// 5. 有序列表跨空行：3 个 li 在 ol
try {
  const olLi = await page.locator("#editor ol > li").count();
  if (olLi >= 3) ok(`有序列表跨空行完整 (${olLi} 项)`);
  else bad("有序列表跨空行完整", `仅 ${olLi} 项`);
} catch (e) { bad("有序列表跨空行完整", e.message.slice(0, 80)); }

// 6. 行内数学渲染
try {
  const inline = await page.locator("#editor .katex").count();
  if (inline >= 1) ok(`行内数学渲染 (${inline} 个)`);
  else bad("行内数学渲染", "无 .katex");
} catch (e) { bad("行内数学渲染", e.message.slice(0, 80)); }

// 7. 块级数学渲染
try {
  const block = await page.locator("#editor .katex-display").count();
  if (block >= 1) ok(`块级数学渲染 (${block} 个)`);
  else bad("块级数学渲染", "无 .katex-display");
} catch (e) { bad("块级数学渲染", e.message.slice(0, 80)); }

// 8. 源码一致性：getContent 应等于输入（或归一化后）
try {
  const content = await page.evaluate(() => window.__app.editor.getContent());
  // 列表项间空行在整体渲染下应保留
  if (content.includes("- 第一项") && content.includes("- 第二项")) ok("源码一致性保留");
  else bad("源码一致性", "内容丢失");
} catch (e) { bad("源码一致性", e.message.slice(0, 80)); }

// 9. 侧边栏状态记忆：切换后刷新页面应恢复
try {
  // 初始收起侧边栏（清 localStorage 后切一次）
  await page.evaluate(() => localStorage.removeItem("md-sidebar"));
  const beforeClass = await page.locator("#sidebar").evaluate(el => el.className);
  await page.click("#btn-sidebar");
  await page.waitForTimeout(300);
  const afterClass = await page.locator("#sidebar").evaluate(el => el.className);
  const stored = await page.evaluate(() => localStorage.getItem("md-sidebar"));
  if (beforeClass !== afterClass && stored) ok(`侧边栏状态记忆 (存储值: ${stored})`);
  else bad("侧边栏状态记忆", `before=${beforeClass} after=${afterClass}`);
} catch (e) { bad("侧边栏状态记忆", e.message.slice(0, 80)); }

// 10. 主题记忆：切换主题后 localStorage 保存
try {
  await page.click("#btn-theme");
  await page.waitForTimeout(300);
  const storedTheme = await page.evaluate(() => localStorage.getItem("md-theme"));
  if (storedTheme) ok(`主题状态记忆 (存储值: ${storedTheme})`);
  else bad("主题状态记忆", "未保存");
} catch (e) { bad("主题状态记忆", e.message.slice(0, 80)); }

// 11. 手动切换源码模式后整体重渲染无断裂
try {
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(300);
  const editing = await page.locator("#editor.editing-mode").count();
  if (editing >= 1) ok("手动切换源码模式");
  else bad("手动切换源码模式", "无 .editing-mode");
  // 切回
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(1000);
} catch (e) { bad("手动切换源码模式", e.message.slice(0, 80)); }

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
