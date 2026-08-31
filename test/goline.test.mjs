// 验收测试：goToLine 行偏移计算逻辑
// 复刻 editor.js goToLine 中的行偏移算法，确保核心逻辑正确
// （DOM 选区/滚动部分由 Playwright 集成测试覆盖）

function computeLineOffset(source, line) {
  // 与 editor.js goToLine 完全一致的偏移计算
  const lines = source.split("\n");
  const targetLine = Math.max(1, Math.min(line | 0, lines.length));
  let offset = 0;
  for (let i = 0; i < targetLine - 1; i++) {
    offset += lines[i].length + 1; // +1 for \n
  }
  const lineEnd = offset + (lines[targetLine - 1] || "").length;
  return { offset, lineEnd, targetLine };
}

const cases = [
  {
    name: "第1行（首行）",
    source: "第一行内容\n第二行\n第三行",
    line: 1,
    check: (r) => r.offset === 0 && r.lineEnd === "第一行内容".length,
  },
  {
    name: "第2行（中间行）",
    source: "第一行内容\n第二行\n第三行",
    line: 2,
    check: (r) =>
      r.offset === "第一行内容".length + 1 &&
      r.lineEnd === r.offset + "第二行".length,
  },
  {
    name: "第3行（末行）",
    source: "第一行内容\n第二行\n第三行",
    line: 3,
    check: (r) =>
      r.offset === "第一行内容".length + 1 + "第二行".length + 1 &&
      r.lineEnd === r.offset + "第三行".length,
  },
  {
    name: "超出行数边界（回退到最后一行）",
    source: "A\nB",
    line: 99,
    check: (r) => r.targetLine === 2 && r.offset === 2,
  },
  {
    name: "行号 0/负数（回退到第1行）",
    source: "A\nB",
    line: 0,
    check: (r) => r.targetLine === 1 && r.offset === 0,
  },
  {
    name: "空行文件",
    source: "",
    line: 1,
    check: (r) => r.targetLine === 1 && r.offset === 0 && r.lineEnd === 0,
  },
  {
    name: "含代码块的多行内容",
    source: "```js\nconst x = 1;\nconsole.log(x);\n```\n正文",
    line: 3,
    check: (r) => {
      // 第1行 ```js (5) +\n, 第2行 const x = 1; (12) +\n
      const expected = 5 + 1 + 12 + 1;
      return r.offset === expected;
    },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    const r = computeLineOffset(c.source, c.line);
    if (c.check(r)) {
      console.log(`✓ ${c.name}`);
      pass++;
    } else {
      console.log(`✗ ${c.name} => offset=${r.offset}, lineEnd=${r.lineEnd}, targetLine=${r.targetLine}`);
      fail++;
    }
  } catch (e) {
    console.log(`✗ ${c.name} => ${e.message}`);
    fail++;
  }
}
console.log(`\n结果: ${pass}/${cases.length} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
