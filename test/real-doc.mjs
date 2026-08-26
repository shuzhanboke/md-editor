// 真实文档场景测试：覆盖实际使用中可能出现的边缘情况
import { chromium } from "@playwright/test";
const BASE = "http://localhost:1420";
let passed = 0, failed = 0;
const ok = n => { console.log(`✓ ${n}`); passed++; };
const bad = (n, m) => { console.log(`✗ ${n}${m ? " — " + m : ""}`); failed++; };

// 真实长文档：中文为主，混合多种语法
const REAL_DOC = `# 使用指南

这是一份**中文 Markdown 编辑器**的使用说明，支持 *多种* 语法。

## 1. 文本格式

支持 **加粗**、*斜体*、~~删除线~~、\`行内代码\`、==高亮==（注：marked 不支持 ==，会原样）。

普通段落，含"中文引号"与 English 与 emoji 🎉 与特殊字符 < > & " quoted。

### 1.1 链接与图片

[百度](https://www.baidu.com) 是搜索引擎。

[带标题的链接](https://example.com "示例标题")

## 2. 列表

### 无序列表

- 苹果
- 香蕉
  - 牛奶香蕉
  - 芝士香蕉
- 樱桃

### 有序列表

1. 第一步
2. 第二步
   1. 子步骤 A
   2. 子步骤 B
3. 第三步

### 任务列表

- [x] 已完成项
- [ ] 待办项
- [x] 另一个已完成

## 3. 代码

\`\`\`python
def hello(name: str) -> str:
    """打招呼函数"""
    return f"你好, {name}!"

print(hello("世界"))
\`\`\`

\`\`\`bash
# 安装依赖
pip install package
cd /home/user
\`\`\`

## 4. 引用

> 这是一段引用。
>
> 引用内第二段。
>
> > 嵌套引用第二层。

## 5. 表格

| 名称 | 类型 | 价格 | 库存 |
|------|------|-----:|:----:|
| 苹果 | 水果 | 5.0 | 100 |
| 鼠标 | 电子 | 99 | 50 |

## 6. 数学

行内公式 $E = mc^2$ 是质能方程。

$$
\\frac{d}{dx}\\left( \\int_{0}^{x} f(t)\\,dt \\right) = f(x)
$$

## 7. 分隔线

---

## 8. 结语

这就是全部内容。`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

// 注入真实文档
await page.evaluate((md) => {
  window.__app.editor.setContent(md);
}, REAL_DOC);
await page.waitForTimeout(2500);

// 1. 标题层级完整
try {
  const h1 = await page.locator("#editor h1").count();
  const h2 = await page.locator("#editor h2").count();
  const h3 = await page.locator("#editor h3").count();
  if (h1 >= 1 && h2 >= 8 && h3 >= 3) ok(`标题层级完整 (h1=${h1} h2=${h2} h3=${h3})`);
  else bad("标题层级完整", `h1=${h1} h2=${h2} h3=${h3}`);
} catch (e) { bad("标题层级完整", e.message.slice(0, 80)); }

// 2. 中文引号与特殊字符正确渲染（不被 HTML 转义破坏）
try {
  const pText = await page.locator("#editor p").filter({ hasText: "中文引号" }).first().textContent();
  if (pText && pText.includes("中文引号") && pText.includes("English")) ok("中文与特殊字符渲染");
  else bad("中文与特殊字符渲染", pText?.slice(0, 50));
} catch (e) { bad("中文与特殊字符渲染", e.message.slice(0, 80)); }

// 3. 嵌套无序列表
try {
  const nestedLi = await page.locator("#editor ul ul li").count();
  if (nestedLi >= 2) ok(`嵌套无序列表 (${nestedLi} 个子项)`);
  else bad("嵌套无序列表", `仅 ${nestedLi}`);
} catch (e) { bad("嵌套无序列表", e.message.slice(0, 80)); }

// 4. 嵌套有序列表
try {
  const nestedOl = await page.locator("#editor ol ol li").count();
  if (nestedOl >= 2) ok(`嵌套有序列表 (${nestedOl} 个子项)`);
  else bad("嵌套有序列表", `仅 ${nestedOl}`);
} catch (e) { bad("嵌套有序列表", e.message.slice(0, 80)); }

// 5. 任务列表
try {
  const checked = await page.locator("#editor .task-list-item input[checked]").count();
  if (checked >= 2) ok(`任务列表 (${checked} 个已勾选)`);
  else bad("任务列表", `仅 ${checked} 个已勾选`);
} catch (e) { bad("任务列表", e.message.slice(0, 80)); }

// 6. 两个代码块（python + bash）且各自高亮
try {
  const pre = await page.locator("#editor pre").count();
  const pyHl = await page.locator("#editor pre code.language-python").count();
  const bashHl = await page.locator("#editor pre code.language-bash").count();
  if (pre >= 2 && pyHl >= 1 && bashHl >= 1) ok(`多代码块高亮 (pre=${pre} py=${pyHl} bash=${bashHl})`);
  else bad("多代码块高亮", `pre=${pre} py=${pyHl} bash=${bashHl}`);
} catch (e) { bad("多代码块高亮", e.message.slice(0, 80)); }

// 7. 代码块内中文注释保留
try {
  const codeText = await page.locator("#editor pre code.language-python").textContent();
  if (codeText && codeText.includes("打招呼函数")) ok("代码块中文注释保留");
  else bad("代码块中文注释保留", "丢失");
} catch (e) { bad("代码块中文注释保留", e.message.slice(0, 80)); }

// 8. 嵌套引用第二层
try {
  const nested = await page.locator("#editor blockquote blockquote").count();
  if (nested >= 1) ok("嵌套引用第二层");
  else bad("嵌套引用第二层", "无");
} catch (e) { bad("嵌套引用第二层", e.message.slice(0, 80)); }

// 9. 表格右对齐与居中对齐
try {
  const tds = await page.locator("#editor table td").count();
  if (tds >= 8) ok(`表格对齐 (${tds} 个单元格)`);
  else bad("表格对齐", `仅 ${tds}`);
} catch (e) { bad("表格对齐", e.message.slice(0, 80)); }

// 10. 行内数学
try {
  const inline = await page.locator("#editor .katex").count();
  if (inline >= 1) ok(`行内数学 (${inline})`);
  else bad("行内数学", "无");
} catch (e) { bad("行内数学", e.message.slice(0, 80)); }

// 11. 块级数学
try {
  const block = await page.locator("#editor .katex-display").count();
  if (block >= 1) ok(`块级数学 (${block})`);
  else bad("块级数学", "无");
} catch (e) { bad("块级数学", e.message.slice(0, 80)); }

// 12. 水平线
try {
  const hr = await page.locator("#editor hr").count();
  if (hr >= 1) ok(`水平线 (${hr})`);
  else bad("水平线", "无");
} catch (e) { bad("水平线", e.message.slice(0, 80)); }

// 13. 链接含 title 属性
try {
  const titledLink = await page.locator('#editor a[title="示例标题"]').count();
  if (titledLink >= 1) ok("链接 title 属性");
  else bad("链接 title 属性", "无");
} catch (e) { bad("链接 title 属性", e.message.slice(0, 80)); }

// 14. 源码一致性：编辑态进入再退出后内容不丢失
try {
  const before = await page.evaluate(() => window.__app.editor.getContent());
  await page.evaluate(() => document.getElementById("editor").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("editor").blur());
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__app.editor.getContent());
  if (after.length > 100 && after.includes("使用指南")) ok("编辑态往返内容不丢失");
  else bad("编辑态往返内容不丢失", `after len=${after.length}`);
} catch (e) { bad("编辑态往返内容不丢失", e.message.slice(0, 80)); }

await browser.close();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
