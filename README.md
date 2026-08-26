# MD 编辑器

一款本地 Markdown 编辑器，灵感来自 Typora，所见即所得。基于 Tauri 2（Rust + Web）构建，轻量高性能。

## 特性

- **即时渲染**：点击块进入源码编辑，移出立即渲染，Typora 式体验
- **完整 Markdown**：标题、加粗/斜体、行内代码、代码块语法高亮、表格、任务列表、引用块、有序/无序列表、链接、图片、水平线
- **数学公式**：行内 `$...$` 与块级 `$$...$$`，基于 KaTeX
- **图表**：Mermaid 流程图、时序图、甘特图等
- **多标签页**：同时编辑多个文件，dirty 标记，关闭确认
- **文件树侧边栏**：浏览本地目录，点击打开
- **目录大纲**：h1-h6 自动生成，点击跳转
- **主题**：浅色 / 暗色一键切换（Ctrl+Shift+T）
- **文件拖拽**：拖拽 .md 文件到窗口直接打开
- **自动保存**：编辑后防抖自动保存
- **导出**：导出 HTML 文件 或 打印为 PDF

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新建 | Ctrl + N |
| 打开 | Ctrl + O |
| 保存 | Ctrl + S |
| 切换主题 | Ctrl + Shift + T |

## 下载与使用

直接运行 `release/md-editor.exe` 即可，无需安装。

### 从源码构建

需要：Node.js 18+、Rust（含 MSVC C++ 工具链）、WebView2 Runtime。

```bash
pnpm install
pnpm tauri build
```

产物位于 `src-tauri/target/release/md-editor.exe`。

## 技术栈

- **后端**：Rust + Tauri 2
- **前端**：原生 HTML/CSS/JS + Vite
- **Markdown**：marked
- **语法高亮**：highlight.js
- **数学**：KaTeX
- **图表**：Mermaid
