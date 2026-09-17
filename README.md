# ChatGPT 侧栏投递 · Edge 扩展 v0.3.1

在网页选中文字后点击“问 ChatGPT”，扩展会打开 Edge 原生侧栏，并将文本送到本窗口最近使用的 ChatGPT 标签页。没有目标时自动创建。默认自动提交，也可切换为“仅填入”。

使用当前 Edge 配置中的 ChatGPT 登录状态，无需 API Key；首次使用时可能需要在目标标签页完成登录或人机验证。

## 安装与更新

1. 在 Edge 打开 `edge://extensions/`，启用“开发人员模式”。
2. 已安装本项目：点击扩展的“重新加载”。首次安装：选择“加载解压的扩展”，指向 `D:\deepseek work\edge-chatgpt-sidebar`。
3. 关闭旧侧栏并重新打开，底部应显示 **v0.3.1**。
4. **刷新来源网页及已有 ChatGPT 标签页**。扩展更新不会替换已经注入页面的旧选区脚本。
5. 也可先解压 `dist/edge-chatgpt-sidebar.zip`，再加载解压后的文件夹。

## 默认稳定模式

| 操作 | 效果 |
| --- | --- |
| 选区浮窗 / 右键发送选中文本 | 打开侧栏、保存任务、定位 ChatGPT、等待就绪后写入 |
| 工具栏图标 / Ctrl+Shift+Y | 打开侧栏；快捷键可在 edge://extensions/shortcuts 修改 |
| 关闭“写入后自动发送” | 新任务仅填入；已排队任务保留入队时的设置 |
| 重试投递 | 仅重试确认尚未写入的失败任务 |
| 复制文本 / 右上角 ↗ | 手动复制原文 / 打开目标 ChatGPT 标签页 |
| 投递记录下拉框 | 查看本窗口的任务、原文、状态与诊断 |

连续点击会串行处理，任务不会互相覆盖。最多同时排队 20 条、保留 40 条记录；单条最多 20,000 字符，超长内容明确拒绝，不静默截断。

只选择来源窗口的 `https://chatgpt.com/` 标签页，不选择 OpenAI 登录页或其他窗口。输入框包含旧草稿时停止写入，避免覆盖或误提交草稿。ChatGPT 正在回复或尚未加载时等待约 30 秒，随后提供可重试错误。

“已发送”表示在页面观察到新的用户消息，或输入框清空并开始生成，不承诺服务器最终完成回答。仅点击发送按钮而没有确认时，显示“已填入”或“发送状态未确认”。未确认任务禁止一键重发，请先到 ChatGPT 检查。

任务保存在 `storage.session`：后台休眠后保留；浏览器关闭或扩展重载会清空。后台重启时恢复尚未投递的任务；投递期间中断则标记未确认，不自动重发。

## 高级 / 实验性模式

在“高级 / 实验性功能”中选择：

- **切换到内嵌侧栏**：进入原有 iframe 界面并启用相应响应头规则。临时隐身、UA 伪装、兼容写入与诊断入口仍保留。
- **打开独立贴边窗口**：打开顶层 ChatGPT 窗口并进入原有面板，可向该窗口投递选区。
- 在旧面板“更多设置 → 返回稳定投递侧栏”关闭实验规则并返回。独立窗口可直接关闭。
- 浏览器重启恢复稳定模式。默认模式不移除 CSP、X-Frame-Options 等响应头，也不改写 UA / Cookie。

内嵌模式仍受网站反嵌入策略、登录和网络环境影响。临时隐身只移除 iframe 导航请求的 Cookie / Authorization，**不是完整的隐私隔离环境**。旧“退出登录”入口保留二次确认，会影响此 Edge 配置中的所有 ChatGPT 标签页。

## 常见问题

- **侧栏没开**：浮窗明确提示“已排队，请点击工具栏打开侧栏”，诊断保留浏览器返回的打开错误；任务不会因此丢失。
- **扩展已更新 / 点击没反应**：刷新来源网页，再关闭并重新打开侧栏。
- **缺少输入框 / 登录验证未完成**：点击 ↗ 完成登录或验证，再重试。扩展不破解验证。
- **输入框已有草稿**：先处理旧草稿再重试。
- **已填入但没有发送**：到 ChatGPT 检查后手动发送，不要反复点击选区按钮。
- **受限页面没有浮窗**：edge:// 内部页、扩展商店等浏览器禁止注入的页面不支持；子框架选区可尝试右键菜单。
- **反馈故障**：复制“任务诊断”信息。它记录状态、元素标识、长度和错误，不包含任务正文或聊天记录。

## 开发与测试

纯 Manifest V3，无构建和运行时依赖。测试需 Node.js 22+ 与 Microsoft Edge，可通过 EDGE_PATH 指定浏览器路径。

```powershell
node tools/verify-queue.mjs
node tools/verify-stable.mjs
node tools/verify-fab.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
```

队列测试覆盖串行、多窗口、补注入、回执丢失不重发和后台恢复。完整链路测试用独立临时 Edge 配置加载实际扩展，以真实鼠标点击浮窗，再使用本地拦截的仿 ChatGPT 编辑器，验证 contenteditable、textarea、多行/空行、草稿保护、延迟按钮、输入回滚、提交无效与高级模式。

这些自动化测试**不连接真实 ChatGPT 账号**，不能替代已登录环境的实际验收。实际网站可能改版；请从普通网页选择两行文字，确认侧栏打开、目标正确、消息出现一次，再测试仅填入、右键和快捷键。

`tools/verify.mjs`、`tools/verify-send.mjs` 是完整链路测试的兼容入口。可加 `--screenshot 完整路径.png` 输出侧栏截图。

打包脚本只包含扩展源码、图标、说明和开发工具，不包含浏览器缓存或旧安装包；覆盖 dist 中的安装包前会保留旧包副本。

## 结构、隐私与权限

- background/delivery.js：持久化队列、目标选择、恢复与结果。
- background/service-worker.js：用户手势打开、路由、菜单与高级模式。
- content/selection.js：选区浮窗；content/chatgpt-bridge.js：编辑器适配、提交确认和去重。
- panel/stable.*：默认侧栏；panel/panel.*：实验界面；rules/：实验嵌入规则。

用户点击发送后，选中文本会交给 ChatGPT；无独立第三方服务或遥测。任务仅在本机浏览器会话中保存。权限包括 sidePanel、storage、alarms（恢复未完成队列）、scripting、tabs、contextMenus，以及旧高级功能的 declarativeNetRequest / browsingData。主机权限用于选区脚本与 ChatGPT 交互。

API 依据：[Edge 侧栏扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/sidebar)、[Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)。
