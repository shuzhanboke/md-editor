// 验收测试：markdown 解析全功能覆盖
import { parseMarkdown } from "../src/markdown.js";

const cases = [
  { name: "标题+段落", md: "# 一级标题\n\n这是段落。", check: h => h.includes("<h1") && h.includes("一级标题") && h.includes("<p>这是段落。</p>") },
  { name: "加粗斜体删除", md: "**粗** *斜* ~~删~~", check: h => h.includes("<strong>粗</strong>") && h.includes("<em>斜</em>") && h.includes("<del>删</del>") },
  { name: "行内代码", md: "用 `code` 标记", check: h => h.includes("<code>code</code>") },
  { name: "代码块高亮", md: "```js\nconsole.log(1);\n```", check: h => h.includes("<pre>") && h.includes('class="hljs') && h.includes("hljs-title") },
  { name: "任务列表", md: "- [x] 完成\n- [ ] 未完", check: h => h.includes("contains-task-list") && h.includes("checkbox") && h.includes("checked") },
  { name: "表格", md: "| A | B |\n|---|---|\n| 1 | 2 |", check: h => h.includes("<table>") && h.includes("<th>") && h.includes("<td>1</td>") },
  { name: "引用块", md: "> 引用文本", check: h => h.includes("<blockquote>") && h.includes("引用文本") },
  { name: "链接", md: "[示例](https://example.com)", check: h => h.includes('href="https://example.com"') && h.includes("示例") },
  { name: "有序列表", md: "1. 第一\n2. 第二", check: h => h.includes("<ol") && h.includes("第一") },
  { name: "行内数学占位", md: "行内 $E=mc^2$ 公式", check: h => h.includes('class="math-inline"') && h.includes('data-math=') },
  { name: "块级数学占位", md: "```math\n\\int_0^1 x dx\n```", check: h => h.includes('class="math-block"') },
  { name: "Mermaid占位", md: "```mermaid\ngraph TD; A-->B\n```", check: h => h.includes('class="mermaid-container"') },
  { name: "图片", md: "![alt](img.png)", check: h => h.includes("<img") && h.includes('alt="alt"') },
  { name: "水平线", md: "---", check: h => h.includes("<hr") },
  { name: "标题2-6级", md: "## 二\n### 三\n#### 四", check: h => h.includes("<h2") && h.includes("<h3") && h.includes("<h4") },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    const html = parseMarkdown(c.md);
    if (c.check(html)) { console.log(`✓ ${c.name}`); pass++; }
    else { console.log(`✗ ${c.name}`); fail++; }
  } catch (e) { console.log(`✗ ${c.name} => ${e.message}`); fail++; }
}
console.log(`\n结果: ${pass}/${cases.length} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
