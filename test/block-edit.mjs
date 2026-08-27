// 测试块级就地编辑（Typora 式）+ 快捷键
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

const DOC = "# 标题\n\n这是普通段落。测试文字。\n\n另一段内容。";

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.evaluate((md) => window.__app.editor.setContent(md), DOC);
await page.waitForTimeout(1500);

// 1. 渲染模式可编辑（contenteditable=true）
try {
  const ce = await page.locator("#editor").getAttribute("contenteditable");
  if (ce === "true") ok("渲染模式 contenteditable=true（可交互）");
  else bad("渲染模式可编辑", `contenteditable=${ce}`);
} catch (e) { bad("渲染模式可编辑", e.message.slice(0, 80)); }

// 2. 点击段落进入块级编辑（该块变源码，其余渲染）
try {
  await page.click("#editor p", { force: true });
  await page.waitForTimeout(300);
  const blockEditing = await page.locator("#editor .block-editing").count();
  if (blockEditing >= 1) ok("点击段落进入块级编辑（.block-editing）");
  else bad("块级编辑", `无 .block-editing`);
} catch (e) { bad("块级编辑", e.message.slice(0, 80)); }

// 3. 块级编辑显示源码（含 markdown 标记）
try {
  const blockText = await page.locator("#editor .block-editing").first().textContent();
  // 段落源码就是纯文本，但如果是标题块会有 #
  if (blockText && blockText.length > 0) ok("块级编辑显示源码");
  else bad("块级编辑显示源码", "空");
} catch (e) { bad("块级编辑显示源码", e.message.slice(0, 80)); }

// 4. Esc 提交块编辑回到渲染
try {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const stillEditing = await page.locator("#editor .block-editing").count();
  if (stillEditing === 0) ok("Esc 提交块编辑回到渲染");
  else bad("Esc 提交", `仍有 ${stillEditing} 个块在编辑`);
} catch (e) { bad("Esc 提交", e.message.slice(0, 80)); }

// 5. 选中文字应用加粗（Ctrl+B）
try {
  // 选中"测试文字"
  await page.evaluate(() => {
    const p = document.querySelector("#editor p");
    if (p) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const ni = node.textContent.indexOf("测试文字");
        if (ni >= 0) {
          const r = document.createRange();
          r.setStart(node, ni);
          r.setEnd(node, ni + 4);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          break;
        }
        node = walker.nextNode();
      }
    }
  });
  await page.waitForTimeout(100);
  // Ctrl+B
  await page.keyboard.down("Control");
  await page.keyboard.press("b");
  await page.keyboard.up("Control");
  await page.waitForTimeout(1500);
  const src = await page.evaluate(() => window.__app.editor.getContent());
  if (src.includes("**测试文字**")) ok("Ctrl+B 加粗选中文字（source 包裹 **）");
  else bad("Ctrl+B 加粗", `source=${src.slice(0, 80)}`);
} catch (e) { bad("Ctrl+B 加粗", e.message.slice(0, 80)); }

// 6. 点击标题块进入编辑
try {
  await page.click("#editor h1", { force: true });
  await page.waitForTimeout(300);
  const blockText = await page.locator("#editor .block-editing").first().textContent();
  if (blockText && blockText.includes("# 标题")) ok("点击标题进入块级编辑（显示 # 标题 源码）");
  else bad("标题块编辑", `text=${blockText?.slice(0, 40)}`);
} catch (e) { bad("标题块编辑", e.message.slice(0, 80)); }

await page.keyboard.press("Escape");
await page.waitForTimeout(1000);

// 7. 手动全文源码模式仍可用
try {
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(300);
  const edMode = await page.locator("#editor.editing-mode").count();
  const text = await page.locator("#editor").textContent();
  if (edMode >= 1 && text.includes("# 标题")) ok("手动全文源码模式仍可用");
  else bad("全文源码模式", `edMode=${edMode}`);
  // 切回
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(1000);
} catch (e) { bad("全文源码模式", e.message.slice(0, 80)); }

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
