# ChatGPT Sidebar v0.3.2 / ChatGPT 侧边栏 v0.3.2

## 中文

这是首个面向普通使用者提供安装包的 GitHub Release。

### 主要功能

- 默认在 Microsoft Edge 侧栏内打开 ChatGPT。
- 在普通网页选择文字后，点击“问 ChatGPT”即可投递原文。
- 支持写入后自动发送和仅填入两种方式。
- 高级选项提供稳定标签页投递、独立贴边窗口和诊断工具。
- 稳定模式包含串行任务队列、失败反馈和安全重试，避免不确定情况下重复提交。
- 项目首页提供完整的中英文新手指南。

### 新手安装

1. 在本页 Assets 中下载 `edge-chatgpt-sidebar-v0.3.2.zip`，不要下载 GitHub 自动生成的 Source code 压缩包。
2. 解压文件，找到直接包含 `manifest.json` 的目录。
3. 在 Edge 打开 `edge://extensions/`，开启“开发人员模式”。
4. 点击“加载解压缩的扩展”，选择上述目录。
5. 点击扩展图标打开侧栏，并按需登录 ChatGPT。

### 从旧版本更新

替换原安装目录中的文件后，依次执行：**重新加载扩展 → 关闭并重新打开侧栏 → 刷新来源网页和已有 ChatGPT 页面**。

内嵌模式会受 ChatGPT 网站策略、登录验证和网络环境影响。无法内嵌时，可从“⋯ → 高级选项”切换到稳定标签页投递。本项目为非官方扩展，与 OpenAI 或 Microsoft 没有隶属关系。

## English

This is the first GitHub Release that provides a ready-to-extract package for regular users.

### Highlights

- Opens ChatGPT inside the Microsoft Edge sidebar by default.
- Sends selected text from a regular webpage after you click “问 ChatGPT” (Ask ChatGPT).
- Supports automatic sending and fill-only mode.
- Advanced options include stable delivery to a ChatGPT tab, a standalone window, and diagnostics.
- Stable mode provides a serial task queue, explicit failure feedback, and safe retry behavior.
- Complete beginner guides are available in Chinese and English.

### Installation

1. Under Assets, download `edge-chatgpt-sidebar-v0.3.2.zip`. Do not use GitHub's automatically generated Source code archives for the easiest installation path.
2. Extract it and find the directory that directly contains `manifest.json`.
3. Open `edge://extensions/` in Edge and enable Developer mode.
4. Click Load unpacked and select that directory.
5. Open the extension from the toolbar and sign in to ChatGPT if required.

### Updating from an older version

After replacing the files in the installed directory, use this order: **reload the extension → close and reopen the sidebar → refresh the source page and existing ChatGPT pages**.

Embedded mode depends on ChatGPT website policies, login verification, and the network environment. If it cannot load, choose stable tab delivery under “⋯ → 高级选项” (Advanced options). This is an unofficial extension and is not affiliated with or endorsed by OpenAI or Microsoft.
