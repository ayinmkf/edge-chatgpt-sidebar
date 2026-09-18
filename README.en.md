# ChatGPT Sidebar for Edge and Chrome

[简体中文](README.md) | **English** | [Share page](https://ayinmkf.github.io/edge-chatgpt-sidebar/)

Send text selected on a web page to ChatGPT while you browse. Use it to explain concepts, translate passages, summarize excerpts, or support your reading. The extension opens ChatGPT inside the Edge or Chrome side panel by default and also offers a stable delivery mode that uses a regular ChatGPT tab.

Current version: **v0.4.0**. This is an unofficial project, not affiliated with or endorsed by OpenAI, Microsoft, or Google.

For X/Twitter, paste the updated share URL: `https://ayinmkf.github.io/edge-chatgpt-sidebar/?v=0.4.0`. The version parameter avoids X's cached preview from the earlier Edge-only presentation.

The extension interface is currently in Chinese. This guide includes the Chinese labels you need to find each control.

## Preview

After text is selected on a regular webpage, the green “问 ChatGPT” (Ask ChatGPT) button appears near the selection:

![The Ask ChatGPT button beside selected text in a real Microsoft Edge webpage](docs/images/selection-popup.png)

After clicking it, the original selection enters the real embedded ChatGPT sidebar. Automatic sending was disabled for this screenshot, so the text remains in the composer for review:

<img src="docs/images/embedded-sidebar.png" alt="Selected text filled into the real embedded ChatGPT sidebar in Microsoft Edge" width="420">

These previews were captured from actual Microsoft Edge and ChatGPT pages, with account details, chat history, and other tabs removed. ChatGPT's appearance may change as the website is updated.

## 1. What is this project for?

Suppose you are reading an article and encounter a confusing paragraph. Select it, click **问 ChatGPT** (“Ask ChatGPT”) near the selection, and the extension fills the ChatGPT composer with that text.

It sends **the original selected text**. It does not automatically add instructions such as “translate,” “explain,” or “summarize.” For your first attempt, turn off automatic sending and add your own instruction before submitting:

| Situation | Instruction you can add before the selected text |
| --- | --- |
| Understanding a term | Explain the following passage for a beginner and give one example. |
| Reading another language | Translate the following passage into English, preserving technical terms. |
| Summarizing an excerpt | Summarize the following content in three points. |
| Studying | Create three self-test questions about the following content. Do not give the answers yet. |

This is not a whole-page scraper. It does not automatically read the entire article, and selecting text alone does not send it. **You must click the selection button or use the send command in the context menu.**

## 2. Before you start

- A computer running Microsoft Edge or Google Chrome. Chrome 116 or later is required; Edge must support the Side Panel API. Development and testing primarily target Windows.
- Working access to [ChatGPT](https://chatgpt.com/), with any login or verification required by the website completed.
- The extension uses the ChatGPT website. You do not need an API key or an API subscription. Available website features, usage limits, and subscriptions are determined by ChatGPT.
- **Regular users do not need Node.js, Git, or a command line.** Those tools are only needed for development, testing, or source control.

First confirm that ChatGPT works in a normal browser tab. Installing this extension will not resolve a network or account access problem.

### Browser compatibility

| Browser | Status | Notes |
| --- | --- | --- |
| Microsoft Edge | Supported | Automated acceptance completed on Edge 152 |
| Google Chrome | Supported | The same suite passed on Chrome for Testing 153 |
| Brave / Vivaldi / Opera | Likely compatible, not fully verified | Chromium-based, but side-panel behavior and browser policies may differ |
| Firefox | Not currently supported | Uses the incompatible `sidebar_action/sidebarAction` API |
| Safari | Not currently supported | Requires separate conversion, signing, and sidebar integration |

## 3. Download and install

Install this project as an unpacked extension. These instructions do not use a browser extension store. Regular users should download the package from the [latest Release](https://github.com/ayinmkf/edge-chatgpt-sidebar/releases/latest).

1. Open the [latest Release](https://github.com/ayinmkf/edge-chatgpt-sidebar/releases/latest). Under **Assets**, download `chatgpt-sidebar-edge-chrome-v0.4.0.zip`. Do not choose GitHub's automatically generated Source code archives.
2. Right-click the downloaded ZIP and choose **Extract All**. Extract it to a folder you intend to keep.
3. Open the extracted folder and find the directory that directly contains `manifest.json`. You should also see folders such as `background`, `content`, and `panel`.
4. Open the extension manager: use `edge://extensions/` in Edge or `chrome://extensions/` in Chrome.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the directory from step 3. Do not select the ZIP file, the `panel` subfolder, or an extra outer directory.
8. Confirm that **ChatGPT 侧边栏** appears in the extension list and is enabled.
9. Open the Extensions menu on the browser toolbar and pin this extension. Depending on the browser version, the control may use a pin or eye icon.
10. Refresh the web page you want to select text from, then click the extension icon to open the sidebar.

Do not move or delete the installed folder: the browser continues to load the extension from it. If you need the source instead, use **Code → Download ZIP** on the repository home page. The source directory can also be loaded directly without building anything.

If you receive a universal ZIP generated by this project, extract it and load its directory containing `manifest.json` in the same way. Do not load both copies at once; that can cause duplicate buttons.

## 4. Send your first selection

1. Click the **ChatGPT 侧边栏** extension icon on the toolbar.
2. The embedded ChatGPT view opens by default. Complete login if required. If verification cannot be completed inside the sidebar, switch to stable delivery as described in section 6.
3. Open **⋯ → 写入后自动发送** (“Automatically send after filling”). For your first attempt, uncheck it.
4. Return to a normal web page, drag to select two lines of text, and release the mouse.
5. Click the green **问 ChatGPT** button near the selection.
6. Wait for the text to appear in the ChatGPT composer. With automatic sending disabled, it should remain there without being submitted.
7. Add an instruction such as “Please explain this passage,” review the text, and click ChatGPT's send button.
8. Confirm that your message appears in the conversation, then wait for a response.

You can also select text, right-click, and choose **发送选中内容到 ChatGPT 侧边栏** (“Send selected content to the ChatGPT sidebar”). `Ctrl+Shift+Y` opens the sidebar; it **does not send the current selection**. Change it at `edge://extensions/shortcuts` in Edge or `chrome://extensions/shortcuts` in Chrome.

### Automatic sending and fill-only mode

- **Automatic sending enabled (default):** clicking “问 ChatGPT” attempts to fill the composer with the original text and click Send. Use this when you intend to submit the selection as-is.
- **Automatic sending disabled:** clicking the button only fills the composer. Add an instruction, edit the content, then send manually. This is useful for translation, explanation, and summarization.

If the composer already contains a draft, the extension stops instead of overwriting or submitting it. Send, save elsewhere, or clear the existing draft before trying again.

## 5. Settings and what is remembered

Click **⋯** at the top of the embedded sidebar. You can change settings without leaving ChatGPT. The menu scrolls vertically in a narrow sidebar.

| Setting in the interface | Default | Purpose and persistence |
| --- | --- | --- |
| 写入后自动发送 — automatic sending | On | Controls submission after filling; saved persistently and shared by both interfaces |
| 选中文本时显示“问 ChatGPT” — selection button | On | Shows the selection button; saved persistently; the context menu still works when off |
| 紧凑模式 — compact mode | Off | Hides the bottom status bar; top settings remain accessible; saved persistently |
| 高级选项 → 稳定投递 — stable delivery | Off | Uses a regular ChatGPT tab; selected mode lasts for the current browser session |
| 高级选项 → 独立贴边窗口 — standalone window | Off | Opens or closes a separate ChatGPT window |
| 高级选项 → 临时隐身 — temporary incognito-like mode | Off | Changes login information sent with embedded navigation; current session only |
| 高级选项 → 兼容写入 — compatibility input | Off | Adjusts the embedded editor input strategy; saved persistently |
| 高级选项 → UA 伪装 — user-agent override | Off | Tries a different browser identifier for embedded navigation; session only; does not guarantee successful verification |
| 高级选项 → 自检 / 诊断 — checks / diagnostics | Manual | Inspects embedding rules or the input field to help troubleshoot |

Mode changes last for the current browser session. Background worker suspension or reopening the sidebar does not reset your choice. **Ending the browser session and restarting, reloading the extension, or updating it restores embedded mode.** If the browser keeps running in the background, closing its windows may not end the session.

## 6. Three modes and what to do if embedding fails

| Mode | Where ChatGPT appears | When to use it |
| --- | --- | --- |
| Embedded sidebar (default) | Inside the Edge or Chrome side panel | Reading a page and chatting side by side |
| Stable delivery | A regular ChatGPT tab in the same browser window | Embedding or login fails, or you want a queue and task diagnostics |
| Standalone window | A separate ChatGPT window | Keeping ChatGPT in its own window next to your reading |

### Switch to stable delivery

1. Open **⋯ → 高级选项** (“Advanced options”).
2. Click **切换到稳定投递（标签页）** (“Switch to stable delivery in a tab”). The loading screen also has a **切换稳定投递** button.
3. The sidebar changes to delivery status and task history.
4. Select text on a normal web page and click “问 ChatGPT” again. The extension chooses the **most recently used ChatGPT tab in the same window**, or creates one if needed, and focuses it.
5. If the target page requires login or verification, complete it. For a failed task that allows retrying, click **重试投递** (“Retry delivery”) in the sidebar.
6. To return, click **返回内嵌侧栏** (“Return to embedded sidebar”).

Switching modes does not automatically resend the previous text. If submission is uncertain, inspect the ChatGPT conversation before trying again.

### Delivery statuses

- **已排队 / 等待 ChatGPT 就绪 — queued / waiting:** the task is saved and waiting for delivery.
- **已填入 — filled:** the text is in the composer; review it and send manually if needed.
- **已发送 — sent:** the extension observed a new user message, or an empty composer with generation starting. This does not guarantee that the server will finish its response.
- **投递失败 — failed:** inspect the diagnostic information, resolve the cause, and retry if the task allows it.
- **发送状态未确认 — unconfirmed:** submission may have happened, but the acknowledgment was incomplete. Inspect the target page instead of sending again.

Stable mode allows up to 20 active queued tasks and retains 40 records, with a 20,000-character limit per task. Each new task captures the automatic-send setting when queued. Page readiness is awaited for approximately 30 seconds before failure is reported. Embedded mode uses **a single pending item**, not the stable mode queue; wait for the current delivery to finish before sending another.

Embedding can be affected by website policies, login state, the browser, and network conditions. The extension does not guarantee that embedding will always work, and it does not bypass login or verification.

## 7. Troubleshooting and updates

### The selection button does not appear

Confirm that the extension and selection-button setting are enabled, then refresh the source page. Select at least two characters. Browser internal pages, extension stores, and ChatGPT pages themselves do not display this button. For text inside a child frame, try the context menu.

### Clicking says the extension was updated, or nothing happens

Use this order: **reload the extension → refresh the source page → select text again**. If you reload the extension after refreshing the page, refresh the page once more. If the problem persists, check for duplicate installations and save the error information.

### Installation says the manifest cannot be found

Extract the ZIP first and select the folder that directly contains `manifest.json`. Selecting an outer directory or the `panel` subfolder is a common mistake. Developer mode must also be enabled.

### Loading never finishes, or login / verification repeats

Complete login or verification in a regular ChatGPT tab first. If embedding still fails, switch to stable delivery. A user-agent override is not a guaranteed fix; temporary incognito-like mode may prevent the embedded view from using your existing login.

### Text is filled but not sent, or a draft already exists

Check the automatic-send setting and handle any existing draft. If the text is already filled, inspect it and send manually in ChatGPT rather than repeatedly clicking the selection button.

### Two buttons or two extension copies appear

At `edge://extensions/` or `chrome://extensions/`, ensure only one copy of this project is enabled, then refresh the page. Other extensions do not need to stay disabled; investigate a particular extension only if the problem occurs when it is enabled alongside this one.

### How to update

1. Download and extract the new source ZIP.
2. Back up any files you changed, then update the files in the original installation directory without adding another outer folder.
3. Open `edge://extensions/` in Edge or `chrome://extensions/` in Chrome, locate this extension, and click Reload.
4. Close and reopen the sidebar, then check the version at the bottom of its settings menu.
5. **Refresh the source page and any existing ChatGPT tabs** so that the updated page scripts take effect.

## 8. Permissions, data, and privacy

- After you click Send, the selected text is passed to the ChatGPT website and is subject to that website's data practices. The extension has no additional third-party relay service or telemetry.
- Delivery text is temporarily stored in the local browser session. It survives background worker suspension but is cleared when the browser session ends or the extension is reloaded. This does not delete chats stored by ChatGPT itself.
- Preferences use extension storage; some settings may sync when browser extension synchronization is enabled.
- Website access is used for the selection button and interaction with the ChatGPT composer. Sidebar, tabs, script injection, context menus, and alarms permissions support those features and queue recovery.
- Embedded mode enables response-header modification rules to support iframe loading. Stable mode disables those embedding rules.
- Temporary incognito-like mode only changes Cookie / Authorization handling for embedded navigation. **It is not a fully isolated private browsing environment.**
- **退出登录 ChatGPT（清除 Cookie）** (“Sign out of ChatGPT / clear cookies”) affects other ChatGPT tabs in the current browser profile. It asks for confirmation before proceeding.
- Diagnostics may contain selected-text fragments or page information. Review them and remove conversation text, account details, and sensitive information before posting a public Issue.

## 9. Development, testing, and packaging

This section is for developers. Regular users do not need to run these commands.

The project uses Manifest V3, has no runtime dependencies, and requires no compilation. Development tests require Node.js 22+. `npm install` installs development-only Puppeteer and Chrome for Testing. Set `BROWSER_PATH` to use a specific Edge or testing Chrome executable; the legacy `EDGE_PATH` remains supported.

```powershell
npm install
npm run test:logic
npm run test:browsers
powershell -NoProfile -ExecutionPolicy Bypass -File tools/package.ps1
```

- `background/`: message routing, modes, and the stable delivery queue.
- `content/`: selection button and ChatGPT editor integration.
- `panel/`: embedded and stable delivery interfaces.
- `rules/`: embedding rules.
- `tools/`: tests, icon tools, installation helper, and packaging script.

End-to-end automation uses isolated temporary Edge and Chrome for Testing profiles with **local mock ChatGPT pages**, not a real account. It cannot replace real-site checks of login, verification, and embedding.

Use `node tools/verify-stable.mjs --screenshot artifacts/panel.png` to save test screenshots inside the project. Browser test profiles use the system temporary directory and are cleaned up on normal completion.

Packaging produces `dist/chatgpt-sidebar-edge-chrome-v0.4.0.zip` with both language guides and a root `manifest.json`, plus a SHA-256 checksum. Git excludes dist, caches, backups, screenshots, and local publishing tools. No open-source license has been specified for this repository.
