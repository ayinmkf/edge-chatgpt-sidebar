/**
 * ChatGPT 侧边栏 —— 后台 Service Worker
 *
 * 职责：
 *  1. 让点击工具栏图标直接开合侧边栏（setPanelBehavior）
 *  2. 处理快捷键命令 -> 打开侧边栏
 *  3. 右键菜单「发送到 ChatGPT 侧边栏」-> 暂存文本并打开侧边栏
 *  4. 维护「临时隐身」的动态 DNR 会话规则（不携带 Cookie 请求 ChatGPT）
 *  5. 兜底：面板里点开的登录弹窗若被塞进小弹窗，把它提升为普通标签页
 *
 * 选中文本仅在用户点击后投递给 ChatGPT；诊断保存在本机。
 */

const CHATGPT_URL = 'https://chatgpt.com/';
const AUTH_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(openai\.com|chatgpt\.com)\//i;

const MENU_SEND = 'cgpt-send-to-panel';
const MENU_OPEN = 'cgpt-open-panel';

const STEALTH_RULE_ID = 9001;
const STEALTH_RULE_ID_OPENAI = 9003;
const UA_RULE_ID = 9002;
importScripts('delivery.js');

/**
 * 兼容模式用的 User-Agent。
 *
 * 背景：本机能观察到 Cloudflare 会对无头/自动化浏览器返回 403 挑战页（cf-mitigated:
 * challenge）。正常情况下你自己的 Edge 是普通浏览器，不会遇到；但如果你所在网络出口
 * 比较敏感、面板里始终看到「Just a moment...」，可以打开「伪装 User-Agent」试试。
 */
const UA_SPOOF_VALUE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';

/** 待发送到面板的文本（面板启动或已打开时消费） */
async function setPendingPrompt(text, source) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('请选择 1 至 20,000 字符');
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  await chrome.storage.session.set({
    pendingPrompt: {
      text: trimmed.slice(0, 20000),
      source,
      at: Date.now()
    }
  });
}

async function notifyPanel(payload) {
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (err) {
    // 侧边栏没开时没有接收方，属正常情况：文本已经存进 storage.session
  }
}

/** Invoke open synchronously inside the click handler; report actual Promise rejection. */
function openPanelNow(windowId) {
  try {
    return Promise.resolve(chrome.sidePanel.open({
      windowId: Number.isInteger(windowId) ? windowId : chrome.windows.WINDOW_ID_CURRENT
    })).then(() => ({ opened: true }), (error) => ({ opened: false, error: String(error?.message || error) }));
  } catch (error) {
    return Promise.resolve({ opened: false, error: String(error?.message || error) });
  }
}

async function requestWindow(msg, sender) {
  if (sender?.tab?.windowId != null) return sender.tab.windowId;
  if (Number.isInteger(msg.windowId) && msg.windowId >= 0) return msg.windowId;
  return (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
}

async function setExperimentalEmbedded(enabled) {
  // Session-only: every browser restart returns to the stable mode.
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enabled ? ['headers', 'site'] : [],
    disableRulesetIds: enabled ? [] : ['headers', 'site']
  });
  if (!enabled) {
    await setStealth(false);
    await setUaSpoof(false);
    await chrome.storage.session.remove('pendingPrompt');
  }
  await chrome.storage.session.set({ experimentalEmbedded: !!enabled });
  await chrome.sidePanel.setOptions({ path: enabled ? 'panel/panel.html' : 'panel/stable.html', enabled: true });
  return !!enabled;
}

async function acceptSelection(msg, sender) {
  const opening = openPanelNow(sender?.tab?.windowId);
  const windowId = await requestWindow(msg, sender);
  const panelResult = await opening;
  const mode = await chrome.storage.session.get('experimentalEmbedded');
  if (mode.experimentalEmbedded) {
    await setPendingPrompt(msg.text, msg.source || 'selection');
    await notifyPanel({ type: 'pending-prompt' });
    return { ok: true, ...panelResult, status: 'queued', experimental: true };
  }
  const job = await CgptDelivery.enqueue(msg.text, msg.source || 'selection', windowId, panelResult);
  return { ok: true, ...panelResult, jobId: job.id, status: job.status };
}

/* ------------------------------------------------------------------ */
/* 临时隐身：动态会话规则（浏览器重启即失效，避免误伤长期登录态）      */
/* ------------------------------------------------------------------ */

async function isStealthEnabled() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((rule) => rule.id === STEALTH_RULE_ID);
}

/**
 * 注意：实测中 requestDomains 这类「域名条件」对扩展页面发起的子框架请求匹配不可靠，
 * 所以这里和静态规则统一使用 urlFilter（已通过 tools/verify.mjs 验证有效）。
 */
function stealthRule(id, filter) {
  return {
    id,
    priority: 2,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'cookie', operation: 'remove' },
        { header: 'authorization', operation: 'remove' }
      ]
    },
    condition: { urlFilter: filter, resourceTypes: ['sub_frame'] }
  };
}

async function setStealth(enabled) {
  if (enabled) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [STEALTH_RULE_ID, STEALTH_RULE_ID_OPENAI],
      addRules: [stealthRule(STEALTH_RULE_ID, '||chatgpt.com^'), stealthRule(STEALTH_RULE_ID_OPENAI, '||openai.com^')]
    });
  } else {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [STEALTH_RULE_ID, STEALTH_RULE_ID_OPENAI]
    });
  }
  await chrome.storage.session.set({ stealth: !!enabled });
  return !!enabled;
}

/* ------------------------------------------------------------------ */
/* 兼容模式：把 ChatGPT 放到一个贴边的独立窗口里（不经 iframe，最稳） */
/* ------------------------------------------------------------------ */

const COMPAT_WIDTH = 430;

async function openCompatWindow(url) {
  // 重用现有窗口，避免重新打开入口时丢失尚未发送的草稿。
  const { compatWindow } = await chrome.storage.session.get('compatWindow');
  if (compatWindow?.id) {
    const existing = await chrome.windows.get(compatWindow.id).catch(() => null);
    if (existing) return chrome.windows.update(existing.id, { focused: true });
  }

  const safeUrl =
    typeof url === 'string' && /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com)\//i.test(url)
      ? url
      : CHATGPT_URL;

  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const width = Math.max(320, Math.min(COMPAT_WIDTH, Math.round((win?.width || 1200) * 0.45)));
  const height = Math.max(400, (win?.height || 900) - 40);
  const left = win ? win.left + win.width - width - 8 : 100;
  const top = win ? win.top + 40 : 100;

  const options = {
    url: safeUrl,
    type: 'popup',
    focused: true,
    width,
    height,
    left,
    top
  };
  let created;
  try {
    created = await chrome.windows.create(options);
  } catch (err) {
    // 多屏、缩放或无头环境可能拒绝贴边坐标，让浏览器自行安排窗口位置。
    if (!/bounds|visible screen space/i.test(String(err?.message || err))) throw err;
    created = await chrome.windows.create({ url: safeUrl, type: 'popup', focused: true });
  }
  if (created?.id) {
    await chrome.storage.session.set({
      compatWindow: { id: created.id, width: created.width || width, height: created.height || height, top: created.top ?? top, browserWindowId: win?.id ?? null, at: Date.now() }
    });
  }
  return created || null;
}

async function closeCompatWindow() {
  const { compatWindow } = await chrome.storage.session.get('compatWindow');
  if (compatWindow?.id) {
    try {
      await chrome.windows.remove(compatWindow.id);
    } catch (err) {
      // 窗口已经关了
    }
  }
  await chrome.storage.session.set({ compatWindow: null });
}

/**
 * 跟随主窗口移动/缩放，保持「贴边」的视觉感受（尽力而为，失败静默忽略）。
 */
chrome.windows.onBoundsChanged.addListener(async (win) => {
  const { compatWindow } = await chrome.storage.session.get('compatWindow').catch(() => ({}));
  if (!compatWindow?.id) return;
  if (compatWindow.browserWindowId != null && win.id !== compatWindow.browserWindowId) return;
  if (win.type !== 'normal') return;
  const width = compatWindow.width || COMPAT_WIDTH;
  try {
    await chrome.windows.update(compatWindow.id, {
      left: win.left + win.width - width - 8,
      top: win.top + 40,
      width,
      height: Math.max(400, win.height - 40)
    });
  } catch (err) {
    // 窗口不存在时忽略
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { compatWindow } = await chrome.storage.session.get('compatWindow').catch(() => ({}));
  if (compatWindow?.id === windowId) {
    await chrome.storage.session.set({ compatWindow: null }).catch(() => {});
  }
});

/* ------------------------------------------------------------------ */
/* 可选：伪装 User-Agent（动态会话规则，浏览器重启自动失效）           */
/* ------------------------------------------------------------------ */

async function isUaSpoofOn() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((rule) => rule.id === UA_RULE_ID);
}

async function setUaSpoof(enabled) {
  if (enabled) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: [
        {
          id: UA_RULE_ID,
          priority: 3,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'user-agent', operation: 'set', value: UA_SPOOF_VALUE }]
          },
          condition: { urlFilter: '||chatgpt.com^', resourceTypes: ['sub_frame'] }
        }
      ]
    });
  } else {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [UA_RULE_ID] });
  }
  await chrome.storage.session.set({ uaSpoof: !!enabled });
  return !!enabled;
}

/* ------------------------------------------------------------------ */
/* 兼容模式：往独立窗口里投递文本                                      */
/* 说明：那个窗口是顶层页面，没有 bridge 的 postMessage 通道，           */
/* 所以这里用 chrome.scripting 直接在页面里执行写入逻辑。               */
/* ------------------------------------------------------------------ */

async function getCompatTabId() {
  const { compatWindow } = await chrome.storage.session.get('compatWindow').catch(() => ({}));
  if (!compatWindow?.id) return null;
  try {
    const tabs = await chrome.tabs.query({ windowId: compatWindow.id });
    const tab = tabs.find((t) => /chatgpt\.com|openai\.com/.test(t.url || '')) || tabs[0];
    return tab?.id ?? null;
  } catch (err) {
    return null;
  }
}

async function sendToCompatWindow(text, autoSend, requestId) {
  const tabId = await getCompatTabId();
  if (tabId == null) return { ok: false, reason: '兼容窗口未打开' };
  try {
    return await CgptDelivery.deliverToTab(tabId, text, !!autoSend, requestId || crypto.randomUUID());
  } catch (error) {
    return { ok: false, filled: false, reason: String(error?.message || error) };
  }
}

/* ------------------------------------------------------------------ */
/* 消息路由                                                           */
/* ------------------------------------------------------------------ */

const handlers = {
  async 'get-delivery-state'(msg, sender) {
    const windowId = await requestWindow(msg, sender);
    const state = await CgptDelivery.state(windowId);
    const mode = await chrome.storage.session.get('experimentalEmbedded');
    return { ...state, experimentalEmbedded: !!mode.experimentalEmbedded };
  },

  async 'set-auto-send'(msg) {
    const autoSend = msg.enabled !== false;
    await chrome.storage.local.set({ autoSend });
    await chrome.storage.sync.set({ autoSend });
    return { ok: true, autoSend };
  },

  async 'set-experimental-embedded'(msg) {
    return { ok: true, experimentalEmbedded: await setExperimentalEmbedded(!!msg.enabled) };
  },

  async 'retry-delivery'(msg, sender) {
    return CgptDelivery.retry(msg.id, await requestWindow(msg, sender));
  },

  async 'open-delivery-target'(msg, sender) {
    return CgptDelivery.openTarget(msg.id, await requestWindow(msg, sender));
  },

  async 'get-state'() {
    const self = chrome.runtime.getManifest();
    const { compatWindow } = await chrome.storage.session.get('compatWindow').catch(() => ({}));
    return {
      ok: true,
      extensionId: chrome.runtime.id,
      version: self.version,
      stealth: await isStealthEnabled(),
      uaSpoof: await isUaSpoofOn(),
      compatWindowId: compatWindow?.id ?? null,
      panelPath: 'panel/panel.html'
    };
  },

  async 'set-stealth'(msg) {
    if (msg.enabled && !(await chrome.storage.session.get('experimentalEmbedded')).experimentalEmbedded) throw new Error('请先开启内嵌实验模式');
    const stealth = await setStealth(!!msg.enabled);
    return { ok: true, stealth };
  },

  async 'set-ua-spoof'(msg) {
    if (msg.enabled && !(await chrome.storage.session.get('experimentalEmbedded')).experimentalEmbedded) throw new Error('请先开启内嵌实验模式');
    const uaSpoof = await setUaSpoof(!!msg.enabled);
    return { ok: true, uaSpoof };
  },

  async 'open-compat'(msg) {
    const created = await openCompatWindow(msg?.url);
    if (msg.experimental) await setExperimentalEmbedded(true);
    return { ok: !!created, windowId: created?.id ?? null };
  },

  async 'close-compat'() {
    await closeCompatWindow();
    return { ok: true };
  },

  async 'toggle-compat'() {
    const { compatWindow } = await chrome.storage.session.get('compatWindow').catch(() => ({}));
    if (compatWindow?.id) {
      await closeCompatWindow();
      return { ok: true, open: false };
    }
    const created = await openCompatWindow();
    return { ok: !!created, open: !!created, windowId: created?.id ?? null };
  },

  async 'open-panel'(msg, sender) {
    const result = await openPanelNow(sender?.tab?.windowId);
    return { ok: result.opened, ...result };
  },

  'send-to-panel': acceptSelection,

  async 'open-tab'(msg) {
    const url = typeof msg.url === 'string' && msg.url.startsWith('http') ? msg.url : CHATGPT_URL;
    await chrome.tabs.create({ url, active: true });
    return { ok: true };
  },

  async 'send-to-compat'(msg) {
    const result = await sendToCompatWindow(msg.text, msg.autoSend, msg.requestId);
    return result;
  },

  async 'compat-health'() {
    const tabId = await getCompatTabId();
    if (tabId == null) return { ok: false, reason: '兼容窗口未打开' };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: 'ISOLATED',
        func: () => ({
          url: location.href.slice(0, 90),
          title: document.title.slice(0, 60),
          editables: [...document.querySelectorAll('[contenteditable]')]
            .slice(0, 8)
            .map((n) => (n.id ? '#' + n.id : n.tagName) + (n.getBoundingClientRect().width ? '' : '(隐藏)'))
            .join(','),
          textareas: document.querySelectorAll('textarea').length,
          bodyText: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 120)
        })
      });
      return { ok: true, info: (results || [])[0]?.result || null };
    } catch (err) {
      return { ok: false, reason: String(err && err.message ? err.message : err) };
    }
  },

  async 'probe-headers'(msg) {
    // 面板自己的 fetch 请求：用来验证 DNR 是否真的剥掉了框架拦截响应头
    const url = typeof msg.url === 'string' ? msg.url : CHATGPT_URL;
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow' });
      return {
        ok: true,
        status: res.status,
        url: res.url,
        frameOptions: res.headers.get('x-frame-options'),
        csp: res.headers.get('content-security-policy'),
        cspReportOnly: res.headers.get('content-security-policy-report-only'),
        cfMitigated: res.headers.get('cf-mitigated')
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  },

  async 'diag-note'(msg) {
    const notes = (await chrome.storage.session.get('diagNotes')).diagNotes || [];
    notes.push({ at: new Date().toISOString(), text: String(msg.text || '').slice(0, 2000) });
    await chrome.storage.session.set({ diagNotes: notes.slice(-30) });
    return { ok: true };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const extensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (!extensionPage && !['send-to-panel', 'open-panel'].includes(msg?.type)) return false;
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve(handler(msg, sender))
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.warn('[ChatGPT 侧边栏] 消息处理失败：', msg.type, err);
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    });
  return true; // 异步响应
});

/* ------------------------------------------------------------------ */
/* 安装 / 启动初始化                                                  */
/* ------------------------------------------------------------------ */

async function initMenus() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (err) {
    // 忽略：没有菜单时 removeAll 可能报错
  }
  chrome.contextMenus.create({
    id: MENU_SEND,
    title: '发送选中内容到 ChatGPT 侧边栏',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: MENU_OPEN,
    title: '打开 ChatGPT 侧边栏',
    contexts: ['page', 'selection', 'link', 'image']
  });
}

async function initializeMode() {
  const mode = await chrome.storage.session.get('experimentalEmbedded');
  await setExperimentalEmbedded(!!mode.experimentalEmbedded);
}
chrome.runtime.onInstalled.addListener(() => {
  void initMenus();
  void initializeMode();
});
chrome.runtime.onStartup.addListener(() => { void initMenus(); void initializeMode(); });
void initializeMode().catch(console.error);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Opening directly preserves activation; close() then open() could consume it.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-panel') void openPanelNow(tab?.windowId);
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_OPEN) { void openPanelNow(tab?.windowId); return; }
  if (info.menuItemId === MENU_SEND) {
    void acceptSelection({ text: info.selectionText || '', source: 'context-menu' }, { tab }).catch(console.error);
  }
});

// 兜底：面板内触发的登录/验证弹窗如果是独立小窗口，提升为普通标签页，
// 保证 OAuth / 人机验证能在顶层上下文里正常完成。
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    if (!tab.pendingUrl && !tab.url) return;
    const url = tab.url || tab.pendingUrl || '';
    if (!AUTH_HOST_RE.test(url)) return;
    const win = await chrome.windows.get(tab.windowId);
    if (win && win.type === 'popup') {
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: true });
    }
  } catch (err) {
    // 忽略：窗口可能已经关闭
  }
});

console.log('[ChatGPT 侧边栏] service worker 已启动，扩展 ID =', chrome.runtime.id);

/* ------------------------------------------------------------------ */
/* 调试辅助：记录 DNR 规则命中情况（需要 declarativeNetRequestFeedback） */
/* ------------------------------------------------------------------ */

const dnrHits = [];

try {
  if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      dnrHits.push({
        at: Date.now(),
        ruleId: info.rule?.ruleId,
        rulesetId: info.rule?.rulesetId,
        url: String(info.request?.url || '').slice(0, 160),
        type: info.request?.type,
        initiator: String(info.request?.initiator || '').slice(0, 80)
      });
      if (dnrHits.length > 60) dnrHits.splice(0, dnrHits.length - 60);
      chrome.storage.session.set({ dnrHits: dnrHits.slice(-40) }).catch(() => {});
    });
  }
} catch (err) {
  console.warn('[ChatGPT 侧边栏] onRuleMatchedDebug 不可用：', err);
}
