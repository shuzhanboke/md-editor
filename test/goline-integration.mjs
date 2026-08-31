// 集成测试：goToLine 完整 DOM 行为（自启动 dev server）
// 验证：渲染模式下调用 goToLine → 切到源码模式 → 选区定位到目标行
import { chromium } from "@playwright/test";
import { spawn } from "child_process";

const PORT = 1420;
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0;
const ok = (n) => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

// 启动 vite dev server（Windows 需 shell:true）
const server = spawn("npx", ["vite", "--port", String(PORT)], {
  stdio: "ignore",
  shell: true,
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let browser, page;
try {
  // 等待 server 就绪（最多 20s）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const res = await fetch(BASE);
      if (res.ok) { ready = true; break; }
    } catch { /* 未就绪 */ }
  }
  if (!ready) throw new Error("dev server 未在 20s 内就绪");

  browser = await chromium.launch();
  page = await (await browser.newContext()).newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.waitForTimeout(1000);

  // 准备多行文档
  const DOC = "第一行\n第二行\n第三行\n第四行\n第五行";
  await page.evaluate((md) => window.__app.editor.setContent(md), DOC);
  await page.waitForTimeout(500);

  // 1. goToLine 切换到源码模式
  try {
    await page.evaluate((l) => window.__app.editor.goToLine(l), 3);
    await page.waitForTimeout(300);
    const edMode = await page.locator("#editor.editing-mode").count();
    if (edMode >= 1) ok("goToLine 切换到源码模式");
    else bad("goToLine 切换到源码模式", "无 .editing-mode");
  } catch (e) { bad("goToLine 切换到源码模式", e.message.slice(0, 80)); }

  // 2. 选区文本为第3行内容
  try {
    const selText = await page.evaluate(() => window.getSelection().toString());
    if (selText === "第三行") ok(`选区定位到第3行 ("${selText}")`);
    else bad("选区定位到第3行", `实际选中: "${selText}"`);
  } catch (e) { bad("选区定位到第3行", e.message.slice(0, 80)); }

  // 3. goToLine(1) 定位到首行
  try {
    await page.evaluate((l) => window.__app.editor.goToLine(l), 1);
    await page.waitForTimeout(300);
    const selText = await page.evaluate(() => window.getSelection().toString());
    if (selText === "第一行") ok(`goToLine(1) 定位首行 ("${selText}")`);
    else bad("goToLine(1) 定位首行", `实际: "${selText}"`);
  } catch (e) { bad("goToLine(1) 定位首行", e.message.slice(0, 80)); }

  // 4. goToLine 超出边界回退到末行
  try {
    await page.evaluate((l) => window.__app.editor.goToLine(l), 999);
    await page.waitForTimeout(300);
    const selText = await page.evaluate(() => window.getSelection().toString());
    if (selText === "第五行") ok(`goToLine(999) 边界回退末行 ("${selText}")`);
    else bad("goToLine(999) 边界回退末行", `实际: "${selText}"`);
  } catch (e) { bad("goToLine(999) 边界回退末行", e.message.slice(0, 80)); }

  // 5. 渲染模式下调用 goToLine 会先切源码（验证从渲染态调用）
  try {
    // 先切回渲染模式
    await page.evaluate(() => {
      if (window.__app.editor.editing) window.__app.editor.toggleSourceMode();
    });
    await page.waitForTimeout(500);
    const beforeEdit = await page.locator("#editor.editing-mode").count();
    await page.evaluate((l) => window.__app.editor.goToLine(l), 2);
    await page.waitForTimeout(300);
    const afterEdit = await page.locator("#editor.editing-mode").count();
    if (beforeEdit === 0 && afterEdit >= 1) ok("渲染模式下 goToLine 自动切源码模式");
    else bad("渲染模式下 goToLine 自动切源码模式", `before=${beforeEdit} after=${afterEdit}`);
  } catch (e) { bad("渲染模式下 goToLine 自动切源码模式", e.message.slice(0, 80)); }

} catch (e) {
  console.error("测试异常:", e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
  // 给 server 进程退出时间，避免 WaitDelay 报错影响退出码
  await sleep(500);
}
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
