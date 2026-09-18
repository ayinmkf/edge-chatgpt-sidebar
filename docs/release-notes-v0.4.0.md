# ChatGPT Sidebar v0.4.0 / ChatGPT 侧边栏 v0.4.0

## 中文

v0.4.0 将同一套扩展正式扩展为 Microsoft Edge 和 Google Chrome 通用版。

### 主要变化

- 同一个安装包支持 Edge 和 Chrome，无需维护两份源码。
- 快捷键入口会根据当前浏览器打开 Edge 或 Chrome 的设置页。
- 安装助手可检测两款浏览器，并在两者同时存在时让用户选择。
- 实验性 User-Agent 覆盖改用当前浏览器标识，不再写死旧版 Edge UA。
- Edge 152 与 Chrome for Testing 153 均通过相同的 19 项完整投递测试。
- 增加浏览器兼容性矩阵；Firefox 和 Safari 当前不受支持。

### 新手安装

1. 在 Assets 中下载 `chatgpt-sidebar-edge-chrome-v0.4.0.zip`，不要下载 GitHub 自动生成的 Source code 压缩包。
2. 解压，并找到根目录中直接包含 `manifest.json` 的文件夹。
3. Edge 打开 `edge://extensions/`；Chrome 打开 `chrome://extensions/`。
4. 开启开发人员模式，点击“加载解压缩的扩展”，选择第 2 步的文件夹。
5. 更新旧版本时按顺序执行：**重新加载扩展 → 刷新来源网页和 ChatGPT 页面**。

内嵌 ChatGPT 仍可能受网站策略、登录验证和网络环境影响。遇到问题可在侧栏高级选项中切换到稳定标签页投递。

## English

v0.4.0 makes the same extension package officially usable in Microsoft Edge and Google Chrome.

### Highlights

- One source tree and one installable package for Edge and Chrome.
- The shortcut link opens the correct settings page for the current browser.
- The installation helper detects both browsers and asks which one to use when both are installed.
- The experimental user-agent override uses the current browser identity instead of an old hard-coded Edge UA.
- The same 19-scenario delivery suite passes in Edge 152 and Chrome for Testing 153.
- A compatibility matrix now documents unverified Chromium browsers and unsupported Firefox/Safari.

### Beginner installation

1. Download `chatgpt-sidebar-edge-chrome-v0.4.0.zip` from Assets. Do not use GitHub's generated Source code archives for this installation path.
2. Extract it and find the folder whose root directly contains `manifest.json`.
3. Open `edge://extensions/` in Edge or `chrome://extensions/` in Chrome.
4. Enable Developer mode, choose **Load unpacked**, and select the folder from step 2.
5. When upgrading, use this order: **reload the extension → refresh the source page and ChatGPT page**.

Embedded ChatGPT may still be affected by website policy, login verification, and network conditions. Switch to stable tab delivery from the sidebar's advanced options if embedding is unavailable.
