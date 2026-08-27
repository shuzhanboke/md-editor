// 测试双模式：默认渲染模式不自动切源码，手动切换，渲染模式选中应用格式
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

const DOC = "# 标题\n\n这是**加粗**文字。普通文本。";

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await page.evaluate((md) => window.__app.editor.setContent(md), DOC);
await page.waitForTimeout(1500);

// 1. 默认渲染模式：显示渲染结果（h1 存在）
try {
  const h1 = await page.locator("#editor h1").count();
  const edMode = await page.locator("#editor.editing-mode").count();
  if (h1 >= 1 && edMode === 0) ok("默认渲染模式（显示渲染结果，非源码）");
  else bad("默认渲染模式", `h1=${h1} editing-mode=${edMode}`);
} catch (e) { bad("默认渲染模式", e.message.slice(0, 80)); }

// 2. 点击编辑器不自动切换源码
try {
  await page.click("#editor p", { force: true });
  await page.waitForTimeout(300);
  const edMode = await page.locator("#editor.editing-mode").count();
  if (edMode === 0) ok("点击不自动切源码");
  else bad("点击不自动切源码", "进入了源码模式");
} catch (e) { bad("点击不自动切源码", e.message.slice(0, 80)); }

// 3. 渲染模式下选中文本应用加粗格式
try {
  // 选中"普通文本"
  await page.evaluate(() => {
    const ed = document.getElementById("editor");
    const p = ed.querySelector("p");
    if (p) {
      const range = document.createRange();
      // 找"普通文本"在 p 中的位置
      const text = p.textContent;
      const idx = text.indexOf("普通文本");
      if (idx >= 0) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const ni = node.textContent.indexOf("普通文本");
          if (ni >= 0) {
            range.setStart(node, ni);
            range.setEnd(node, ni + 4);
            break;
          }
          node = walker.nextNode();
        }
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
  await page.waitForTimeout(200);
  // 点加粗按钮
  await page.click('.ft-btn[data-fmt="bold"]', { force: true });
  await page.waitForTimeout(1500);
  const content = await page.evaluate(() => window.__app.editor.getContent());
  if (content.includes("**普通文本**")) ok("渲染模式选中应用加粗格式（source 中包裹 **）");
  else bad("渲染模式选中加粗", `source=${content.slice(0, 80)}`);
} catch (e) { bad("渲染模式选中加粗", e.message.slice(0, 80)); }

// 4. 手动切换到源码模式
try {
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(300);
  const edMode = await page.locator("#editor.editing-mode").count();
  const text = await page.locator("#editor").textContent();
  if (edMode >= 1 && text.includes("**加粗**")) ok("手动切换源码模式（显示原始 markdown）");
  else bad("源码模式", `edMode=${edMode} text=${text?.slice(0, 50)}`);
} catch (e) { bad("源码模式", e.message.slice(0, 80)); }

// 5. 源码模式可编辑
try {
  await page.evaluate(() => {
    const ed = document.getElementById("editor");
    ed.textContent = "# 新内容\n\n段落";
    ed.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const src = await page.evaluate(() => window.__app.editor.getContent());
  if (src.includes("新内容")) ok("源码模式可编辑");
  else bad("源码模式可编辑", "内容未更新");
} catch (e) { bad("源码模式可编辑", e.message.slice(0, 80)); }

// 6. 切回渲染模式
try {
  await page.click("#btn-mode", { force: true });
  await page.waitForTimeout(1500);
  const h1 = await page.locator("#editor h1").count();
  const edMode = await page.locator("#editor.editing-mode").count();
  if (h1 >= 1 && edMode === 0) ok("切回渲染模式（重新渲染）");
  else bad("切回渲染模式", `h1=${h1} edMode=${edMode}`);
} catch (e) { bad("切回渲染模式", e.message.slice(0, 80)); }

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
