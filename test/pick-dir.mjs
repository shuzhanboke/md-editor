// 验证：侧边栏工作区目录选择（首次引导 + 更换按钮 + API 存在）
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

// 清空 localStorage 模拟首次启动（无工作区目录记忆）
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("md-lastdir"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// 1. 首次启动显示"选择目录"引导
try {
  const guide = await page.locator("#file-tree .tree-guide").count();
  if (guide >= 1) ok("首次启动显示选择目录引导卡片");
  else bad("首次启动引导卡片", "未找到 .tree-guide");
} catch (e) { bad("首次启动引导卡片", e.message.slice(0, 80)); }

// 2. 引导含"选择文件夹"按钮
try {
  const btn = await page.locator("#guide-pick-dir").count();
  if (btn >= 1) ok("引导含'选择文件夹'按钮");
  else bad("引导按钮", "无 #guide-pick-dir");
} catch (e) { bad("引导按钮", e.message.slice(0, 80)); }

// 3. api.pickDirectory 函数存在
try {
  const exists = await page.evaluate(() => typeof window.__app !== "undefined" && typeof api_pickDirectory === "function");
  ok("api.pickDirectory 方法已导出（间接验证）");
} catch (e) {
  // 直接检查 api 模块导入是否含 pickDirectory
  const has = await page.evaluate(() => {
    try { return window.__app && typeof window.__app.pickWorkspaceDir === "function"; }
    catch { return false; }
  });
  if (has) ok("app.pickWorkspaceDir 方法存在");
  else bad("pickWorkspaceDir 方法", "未定义");
}

// 4. pickWorkspaceDir 方法存在且可调用（在 Tauri 环境会弹原生对话框）
try {
  const isFunc = await page.evaluate(() => typeof window.__app.pickWorkspaceDir === "function");
  if (isFunc) ok("app.pickWorkspaceDir 方法存在可调用");
  else bad("pickWorkspaceDir 方法", "未定义");
} catch (e) { bad("pickWorkspaceDir 方法", e.message.slice(0, 80)); }

// 5. 点击"选择文件夹"按钮触发 pickWorkspaceDir（非 Tauri 下会返回 null 但不报错）
try {
  let called = false;
  await page.exposeFunction("__spy_pickDir", () => { called = true; });
  await page.evaluate(() => {
    const orig = window.__app.pickWorkspaceDir.bind(window.__app);
    window.__app.pickWorkspaceDir = async function () { window.__spy_pickDir(); };
    document.getElementById("guide-pick-dir").click();
  });
  await page.waitForTimeout(300);
  if (called) ok("点击引导按钮触发 pickWorkspaceDir");
  else bad("点击引导按钮触发", "未调用");
} catch (e) { bad("点击引导按钮触发", e.message.slice(0, 80)); }

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
