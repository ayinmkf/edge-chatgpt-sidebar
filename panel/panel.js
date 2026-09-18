/**
 * ChatGPT 侧边栏 —— 面板逻辑
 *
 * 面板自己是一个扩展页面（chrome-extension://<id>/panel/panel.html），
 * 里面用 iframe 承载 https://chatgpt.com/。
 *
 * 注意：由于 ChatGPT 会返回 COEP: require-corp，iframe 与面板之间属于交叉来源隔离，
 * 面板无法直接访问 iframe 的 DOM。因此所有交互都走 postMessage 握手协议：
 *   面板 -> bridge : { source:'cgpt-sidepanel-panel', type:'prompt' | 'config' | 'ping', ... }
 *   bridge -> 面板 : { source:'cgpt-sidepanel-bridge', type:'bridge-ready' | 'prompt-result' | 'pong', ... }
 */

const CHATGPT_URL = 'https://chatgpt.com/';
const PANEL_SOURCE = 'cgpt-sidepanel-panel';
const BRIDGE_SOURCE = 'cgpt-sidepanel-bridge';
// 注意：这个超时只用于「还没握手时显示提示」，不会自动重新加载 iframe
// （自动重载会打断 Cloudflare 校验流程），所以给宽松一点，慢网络下别误报。
const READY_TIMEOUT_MS = 20000;
const DELIVERY_TIMEOUT_MS = 18000;
const ALIVE_PROBE_MS = 1200;
const PENDING_TTL_MS = 120000;

const STORAGE_ORIGINS = [
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://auth.openai.com',
  'https://openai.com'
];

const el = {
  frame: document.getElementById('frame'),
  loading: document.getElementById('loading'),
  statusbar: document.getElementById('statusbar'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  confirm: document.getElementById('confirm'),
  menu: document.getElementById('menu'),
  compatStrip: document.getElementById('compat-hint'),
  btnReload: document.getElementById('btn-reload'),
  btnTab: document.getElementById('btn-tab'),
  btnCompat: document.getElementById('btn-compat'),
  btnCompatBack: document.getElementById('btn-compat-back'),
  btnStealth: document.getElementById('btn-stealth'),
  btnMenu: document.getElementById('btn-menu'),
  btnLogout: document.getElementById('btn-logout'),
  btnConfirmLogout: document.getElementById('btn-confirm-logout'),
  btnCancelLogout: document.getElementById('btn-cancel-logout'),
  btnProbe: document.getElementById('btn-probe'),
  btnDiag: document.getElementById('btn-diag'),
  btnShortcut: document.getElementById('btn-shortcut'),
  optAutosend: document.getElementById('opt-autosend'),
  optFab: document.getElementById('opt-fab'),
  optHideToolbar: document.getElementById('opt-hidetoolbar'),
  optUaSpoof: document.getElementById('opt-uaspoof'),
  optLegacyWrite: document.getElementById('opt-legacywrite'),
  menuVersion: document.getElementById('menu-version')
};

const state = {
  frameWindow: null,
  ready: false,
  readyTimer: 0,
  verifyTimer: 0,
  deliverTimer: 0,
  pendingDelivery: null,
  lastPendingAt: 0,
  sessionStartedAt: 0,
  bridgeVersion: '',
  reloadGuard: 0,
  pendingConfigSync: false,
  stealth: false,
  uaSpoof: false,
  compatOpen: false,
  settings: { autoSend: true, fab: true, hideToolbar: false, legacyWrite: false }
};

/* ------------------------------------------------------------------ */
/* 通用工具                                                           */
/* ------------------------------------------------------------------ */

function setStatus(text, level) {
  el.statusText.textContent = text;
  el.statusDot.className = 'dot' + (level ? ' ' + level : '');
}

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, error: 'no response' });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
}

function storageGet(area, keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage[area].get(keys, (data) => resolve(data || {}));
    } catch (err) {
      resolve({});
    }
  });
}

function storageSet(area, value) {
  return new Promise((resolve) => {
    try {
      chrome.storage[area].set(value, () => resolve(true));
    } catch (err) {
      resolve(false);
    }
  });
}

function postToBridge(payload) {
  if (!state.frameWindow) return false;
  try {
    state.frameWindow.postMessage({ ...payload, source: PANEL_SOURCE }, 'https://chatgpt.com');
    return true;
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 加载 / 连接状态                                                    */
/* ------------------------------------------------------------------ */

function beginLoading(statusText) {
  state.ready = false;
  state.sessionStartedAt = Date.now();
  el.loading.hidden = false;
  el.loading.innerHTML = loadingTemplate('正在加载 ChatGPT…');
  bindLoadingButtons();
  setStatus(statusText || '正在加载 ChatGPT…', 'warn');
  clearTimeout(state.readyTimer);
  state.readyTimer = setTimeout(onReadyTimeout, READY_TIMEOUT_MS);
}

/** 探测 iframe 里的 bridge 是否还活着（避免每次打开面板都强制重新加载） */
function probeBridgeAlive(timeoutMs = ALIVE_PROBE_MS) {
  return new Promise((resolve) => {
    if (!el.frame || !el.frame.contentWindow) {
      resolve(false);
      return;
    }
    let done = false;
    const onMsg = (event) => {
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.type !== 'bridge-ready' && data.type !== 'pong') return;
      finish(true);
    };
    const finish = (alive) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      resolve(alive);
    };
    window.addEventListener('message', onMsg);
    try {
      el.frame.contentWindow.postMessage({ source: PANEL_SOURCE, type: 'ping' }, '*');
    } catch (err) {
      finish(false);
      return;
    }
    setTimeout(() => finish(false), timeoutMs);
  });
}

function loadingTemplate(title, hint) {
  return `
    <div class="overlay-card">
      <div class="spinner" aria-hidden="true"></div>
      <p class="overlay-title">${title}</p>
      <p class="overlay-hint">${hint || '首次打开若出现人机验证，请在标签页中完成一次验证。'}</p>
      <div class="overlay-actions">
        <button class="btn" id="btn-slow-tab" type="button">在标签页中打开</button>
        <button class="btn" id="btn-slow-retry" type="button">重试</button>
      </div>
    </div>`;
}

function bindLoadingButtons() {
  const tabBtn = document.getElementById('btn-slow-tab');
  const retryBtn = document.getElementById('btn-slow-retry');
  const compatBtn = document.getElementById('btn-slow-compat');
  if (tabBtn) tabBtn.addEventListener('click', openInTab);
  if (retryBtn) retryBtn.addEventListener('click', () => reloadFrame({ bustCache: true }));
  if (compatBtn) compatBtn.addEventListener('click', () => toggleCompat(true));
}

function onReadyTimeout() {
  if (state.ready) return;
  el.loading.hidden = false;
  el.loading.innerHTML = `
    <div class="overlay-card">
      <p class="overlay-title">还没连上 ChatGPT</p>
      <p class="overlay-hint">
        如果下面显示的是「Just a moment…」人机验证：点「打开标签页验证」，
        在标签页里过一次验证即可（同一浏览器配置共享），完成后这里会自动刷新。<br>
        若一直连不上，用「兼容模式」最稳：把 ChatGPT 放进独立贴边窗口，不受嵌入限制。
      </p>
      <div class="overlay-actions">
        <button class="btn" id="btn-slow-verify" type="button">打开标签页验证</button>
        <button class="btn" id="btn-slow-compat" type="button">兼容模式</button>
        <button class="btn" id="btn-slow-retry" type="button">重试</button>
      </div>
    </div>`;
  bindLoadingButtons();
  const verifyBtn = document.getElementById('btn-slow-verify');
  if (verifyBtn) verifyBtn.addEventListener('click', openVerifyTab);
  setStatus('未连上：可先「打开标签页验证」，或改用兼容模式', 'err');
}

/**
 * 打开标签页让用户在顶层上下文里过一次 Cloudflare 验证。
 * 验证通过后 cf_clearance 等 Cookie 会写进同一配置，这里稍后自动重载 iframe。
 */
async function openVerifyTab() {
  setStatus('已打开验证标签页：完成验证后这里会自动重新加载', 'warn');
  await send({ type: 'open-tab', url: CHATGPT_URL });
  clearTimeout(state.verifyTimer);
  state.verifyTimer = setTimeout(() => {
    reloadFrame();
    setStatus('已按「完成验证」重新加载面板', 'warn');
  }, 15000);
}

/**
 * 重载 iframe。
 *
 * 重要：默认**不加**任何查询参数、也不强制绕过缓存。
 * 之前每次打开面板都带 ?dsh_reload=<时间戳> 重新导航，等于每次都是全新请求，
 * 会把 Cloudflare 的校验结果（__cf_bm / cf_clearance 这类跟页面绑定的状态）一次次作废，
 * 于是每次打开都弹人机验证。只有用户主动点「重载」时才做强制刷新。
 */
function reloadFrame({ bustCache = false } = {}) {
  beginLoading('正在重新加载 ChatGPT…');
  state.frameWindow = null;
  state.sessionStartedAt = Date.now();
  el.frame.src = bustCache ? CHATGPT_URL + '?dsh_reload=' + Date.now() : CHATGPT_URL;
}

function openInTab() {
  const current = el.frame && el.frame.src ? el.frame.src : CHATGPT_URL;
  const url = /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com)\//i.test(current) ? current : CHATGPT_URL;
  send({ type: 'open-tab', url });
  setStatus('已在标签页中打开 ChatGPT', 'ok');
}

/* ------------------------------------------------------------------ */
/* 与 bridge 的消息往来                                               */
/* ------------------------------------------------------------------ */

function bridgeConfig() {
  return {
    type: 'config',
    autoSend: !!state.settings.autoSend,
    legacyWrite: !!state.settings.legacyWrite
  };
}

function handleBridgeReady() {
  state.ready = true;
  clearTimeout(state.readyTimer);
  el.loading.hidden = true;
  setStatus(
    state.stealth ? '已连接 ChatGPT（临时隐身：未登录状态）' : '已连接 ChatGPT',
    state.stealth ? 'warn' : 'ok'
  );
  postToBridge(bridgeConfig());
  consumePendingPrompt();
}

async function consumePendingPrompt() {
  const data = await storageGet('session', 'pendingPrompt');
  const pending = data.pendingPrompt;
  if (!pending || !pending.text) return;
  if (!state.ready && !state.compatOpen) return;
  if (pending.at && Date.now() - pending.at > PENDING_TTL_MS) {
    setStatus('待发送内容已过期（超过 2 分钟），请重新选中后再次发送', 'warn');
    return;
  }
  // 同一个时间戳只处理一次，避免 storage.onChanged 触发的重复执行
  if (pending.at && pending.at <= state.lastPendingAt) return;
  state.lastPendingAt = pending.at || Date.now();
  await deliverPrompt(pending.text, pending.source, pending.at);
}

/**
 * 把文本送进 iframe 里的 ChatGPT。
 *
 * 可靠性要点（之前就是这里出问题）：
 *  - 带 requestId 做请求/应答配对，明确知道是「没送到」还是「送到了但写不进输入框」
 *  - 每条请求都有超时；超时就重发一次，再失败就明确告诉用户可以手动粘贴
 *  - 只有拿到成功回执才清空 pending；失败则保留，避免内容静默丢失
 */
async function deliverPrompt(text, source, at, attempt = 1) {
  if (!text) return;

  // 兼容模式：ChatGPT 在独立窗口里，走 scripting 注入而不是 postMessage
  if (state.compatOpen) {
    setStatus(`正在发送 ${text.length} 个字符到兼容窗口…（第 ${attempt} 次）`, 'warn');
    const res = await send({ type: 'send-to-compat', text, autoSend: !!state.settings.autoSend, requestId: `compat-${at || Date.now()}` });
    if (res && res.ok) {
      clearPending();
      if (res.reason) {
        setStatus('已填入兼容窗口，但' + res.reason, 'warn');
      } else {
        setStatus(res.sent ? '已填入兼容窗口并发送' : '已填入兼容窗口，等待你按回车发送', 'ok');
      }
    } else {
      const reason = (res && res.reason) || '未知原因';
      setStatus('兼容窗口填入失败：' + reason, 'err');
      if (res && res.diag) logDiag('兼容窗口', res.diag);
      showPasteFallback(text);
    }
    return;
  }

  if (!state.ready || !state.frameWindow) {
    // ChatGPT 还没握手成功：保留 pending，等 bridge-ready 时再送
    setStatus('ChatGPT 尚未就绪，内容已暂存，连上后自动发送', 'warn');
    return;
  }

  const requestId = `embedded-${at || Date.now()}`;
  state.pendingDelivery = { requestId, text, source, at, attempt };

  // 带上 autoSend：让「这一次发送」的行为与面板当前开关一致
  postToBridge({
    type: 'prompt',
    text,
    selectionSource: source || 'unknown',
    requestId,
    autoSend: !!state.settings.autoSend
  });
  setStatus(`正在发送 ${text.length} 个字符到 ChatGPT…（第 ${attempt} 次）`, 'warn');

  clearTimeout(state.deliverTimer);
  state.deliverTimer = setTimeout(() => onDeliveryTimeout(text, source, at, attempt), DELIVERY_TIMEOUT_MS);
}

async function onDeliveryTimeout(text, source, at, attempt) {
  const pending = state.pendingDelivery;
  if (!pending || pending.requestId !== state.pendingDelivery?.requestId) return;
  if (state.deliveryDone) return;

  // 回执丢失不代表没有提交，禁止自动重发。
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    /* 剪贴板不可用就忽略 */
  }
  await showPasteFallback(text);
}

async function showPasteFallback(text) {
  state.pendingDelivery = null;
  if (state.compatOpen) {
    setStatus('兼容窗口填入失败：内容已复制到剪贴板，请手动粘贴', 'err');
  } else {
    setStatus('未确认投递结果：请先检查 ChatGPT，再决定是否手动粘贴', 'err');
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    /* 忽略 */
  }
  el.loading.hidden = false;
  el.loading.innerHTML = `
    <div class="overlay-card">
      <p class="overlay-title">没能把文字送进 ChatGPT</p>
      <p class="overlay-hint">
        内容已经复制到剪贴板，可直接 Ctrl+V 粘贴。<br>
        下面是面板实际看到的输入框情况，点「查看诊断」可复制出来发给我定位问题。
      </p>
      <div class="overlay-actions">
        <button class="btn" id="btn-fallback-diag" type="button">查看诊断</button>
        <button class="btn" id="btn-fallback-retry" type="button">再试一次</button>
        <button class="btn" id="btn-fallback-close" type="button">关闭</button>
      </div>
      <pre id="diag-out" class="diag"></pre>
    </div>`;
  const diagBtn = document.getElementById('btn-fallback-diag');
  const retryBtn = document.getElementById('btn-fallback-retry');
  const closeBtn = document.getElementById('btn-fallback-close');
  if (diagBtn) diagBtn.addEventListener('click', () => runDiagnostics());
  if (retryBtn)
    retryBtn.addEventListener('click', () => {
      el.loading.hidden = true;
      deliverPrompt(text, 'retry', Date.now(), 1);
    });
  if (closeBtn) closeBtn.addEventListener('click', () => (el.loading.hidden = true));
}

/** 把诊断信息打到面板里，便于把「真实 DOM 情况」反馈出来 */
function logDiag(where, diag) {
  const lines = [`【${where}】`];
  for (const [key, value] of Object.entries(diag || {})) {
    lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  const text = lines.join('\n');
  console.log(text);
  const out = document.getElementById('diag-out');
  if (out) out.textContent = text;
}

/** 主动询问两边真实的输入框情况 */
async function runDiagnostics() {
  const out = document.getElementById('diag-out');
  if (out) out.textContent = '正在检查…';
  const parts = [];

  const expectVersion = chrome.runtime.getManifest().version;
  parts.push(
    `【版本】面板=${expectVersion}  页面内脚本=${state.bridgeVersion || '(未握手)'}` +
      (state.bridgeVersion && state.bridgeVersion !== expectVersion
        ? '  ⚠️ 不一致：页面里是旧脚本，难怪消息没回执'
        : '')
  );
  parts.push(`【写入模式】${state.settings.legacyWrite ? '兼容模式（insertHTML 优先）' : '标准模式（execCommand insertText）'}`);

  if (state.compatOpen) {
    const res = await send({ type: 'compat-health' });
    parts.push(res.ok ? `【兼容窗口】\n${JSON.stringify(res.info, null, 2)}` : `【兼容窗口】失败：${res.reason}`);
  } else if (state.frameWindow) {
    const result = await askBridge({ type: 'diag', requestId: String(Date.now()) });
    parts.push(result ? `【嵌入式面板】\n${JSON.stringify(result.diag || result, null, 2)}` : '【嵌入式面板】脚本无响应（可能根本没人机验证页之外的 ChatGPT 页面）');
  } else {
    parts.push('【嵌入式面板】ChatGPT 尚未连接，无诊断数据');
  }

  const text = parts.join('\n\n');
  console.log(text);
  if (out) out.textContent = text;
  setStatus('诊断已输出（可复制面板里的文字反馈）', 'ok');
}

/** 向 bridge 发请求并等待对应回执 */
function askBridge(payload, timeoutMs = 3000, expectType = 'diag-result') {
  return new Promise((resolve) => {
    const requestId = payload.requestId || String(Date.now());
    let done = false;
    const onMsg = (event) => {
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      if (data.requestId !== requestId) return;
      if (data.type !== expectType) return;
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      resolve(data);
    };
    window.addEventListener('message', onMsg);
    postToBridge({ ...payload, requestId });
    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMsg);
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * 自检：让输入框自己跑一遍「写入 → 回读 → 找发送按钮」，
 * 一步到位看出链路断在哪里。
 */
async function runSelfTest() {
  const out = document.getElementById('diag-out');
  if (out) out.textContent = '正在自检（会在输入框里写入一段临时文本然后还原）…';

  if (state.compatOpen) {
    const res = await send({ type: 'compat-health' });
    if (out) out.textContent = res.ok ? JSON.stringify(res.info, null, 2) : '兼容窗口自检失败：' + res.reason;
    return;
  }

  if (!state.frameWindow) {
    if (out) out.textContent = 'ChatGPT 尚未连接，无法自检。请先让面板连上 ChatGPT。';
    setStatus('无法自检：ChatGPT 未连接', 'err');
    return;
  }

  const result = await askBridge({ type: 'self-test', requestId: String(Date.now()) }, 12000, 'self-test-result');
  if (!result) {
    if (out) out.textContent = '内容脚本没有响应（面板里可能不是 ChatGPT 页面，或脚本未注入）。';
    setStatus('自检失败：内容脚本无响应', 'err');
    return;
  }

  const report = result.report || {};
  const lines = [];
  for (const step of report.steps || []) lines.push(step);
  if (report.sendButtonCandidates) {
    lines.push('');
    lines.push('发送按钮候选：');
    for (const line of report.sendButtonCandidates) lines.push('  ' + line);
  }
  if (report.insertError) lines.push('写入报错：' + report.insertError);
  if (report.error) lines.push('错误：' + report.error);
  lines.push('');
  lines.push(report.ok ? '结论：写入通道正常（面板→输入框没问题）' : '结论：写入通道有问题，见上面第 4 步');

  const text = lines.join('\n');
  console.log(text);
  if (out) out.textContent = text;
  setStatus(report.ok ? '自检通过：文字能写进输入框' : '自检发现问题：见面板内容', report.ok ? 'ok' : 'err');
}

async function clearPending() {
  await storageSet('session', { pendingPrompt: { text: '', source: '', at: 0 } });
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.source !== BRIDGE_SOURCE) return;
  if (event.origin !== 'https://chatgpt.com' || event.source !== el.frame.contentWindow) return;
  // 只接受来自我们 iframe 的消息
  if (state.frameWindow && event.source !== state.frameWindow) return;
  if (!state.frameWindow) state.frameWindow = event.source;

  if (data.type === 'bridge-ready') {
    /*
     * 版本校验：扩展重新加载后，页面里已注入的旧内容脚本不会自动更新，
     * 它的扩展上下文已失效 —— 仍会回应握手，但收到消息后静默失败，
     * 表现为面板一直等不到回执（"两次都没送达"），而代码其实是新的。
     * 这里比对版本号，不一致就强制重新加载 iframe 以注入新脚本。
     */
    const bridgeVersion = String(data.bridgeVersion || '(旧版无版本号)');
    const expectVersion = chrome.runtime.getManifest().version;
    state.bridgeVersion = bridgeVersion;
    if (bridgeVersion !== expectVersion) {
      setStatus(`检测到页面里是旧版脚本（${bridgeVersion} ≠ ${expectVersion}），正在刷新 ChatGPT…`, 'warn');
      state.reloadGuard = (state.reloadGuard || 0) + 1;
      if (state.reloadGuard <= 2) {
        reloadFrame({ bustCache: true });
      } else {
        setStatus('页面里仍是旧版脚本，请关闭侧边栏再重新打开', 'err');
      }
      return;
    }
    state.reloadGuard = 0;

    // 握手时同步一次配置，保证 autoSend 等设置是最新的
    if (state.pendingConfigSync) {
      state.pendingConfigSync = false;
      postToBridge(bridgeConfig());
    }
    handleBridgeReady();
    return;
  }

  if (data.type === 'prompt-result') {
    const current = state.pendingDelivery;
    // 忽略过期请求的回执
    if (current && data.requestId && data.requestId !== current.requestId) return;
    clearTimeout(state.deliverTimer);
    state.pendingDelivery = null;

    if (data.ok && data.sent) {
      setStatus('已发送到 ChatGPT（方式：' + (data.via || 'button') + '，写入策略：' + (data.strategy || '?') + '）', 'ok');
      clearPending();
    } else if (data.ok && data.filled) {
      setStatus(
        '已填入 ChatGPT 输入框，但没能自动发送（' + (data.reason || '未找到发送按钮') + '）——请手动按回车',
        'warn'
      );
      clearPending();
    } else if (data.ok) {
      setStatus('已送达 ChatGPT（未自动发送）', 'ok');
      clearPending();
    } else {
      // 明确失败：不再静默，直接给出原因 + 真实 DOM 诊断 + 兜底入口
      const reason = data.reason || '未知原因';
      setStatus('填入失败：' + reason, 'err');
      if (data.diag) logDiag('嵌入式面板', data.diag);
      if (current) showPasteFallback(current.text);
    }
    return;
  }

  if (data.type === 'debug') {
    setStatus('bridge 调试：' + (data.text || ''), 'warn');
  }
});

/* ------------------------------------------------------------------ */
/* 设置                                                              */
/* ------------------------------------------------------------------ */

async function loadSettings() {
  const sync = await storageGet('sync', ['autoSend', 'fab', 'hideToolbar', 'legacyWrite']);
  const local = await storageGet('local', ['autoSend', 'fab', 'hideToolbar', 'legacyWrite']);
  state.settings.autoSend = pick(sync.autoSend, local.autoSend, true);
  state.settings.fab = pick(sync.fab, local.fab, true);
  state.settings.hideToolbar = pick(sync.hideToolbar, local.hideToolbar, false);
  state.settings.legacyWrite = pick(sync.legacyWrite, local.legacyWrite, false);
  applySettings();
}

function pick(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return false;
}

/**
 * 应用设置。
 *
 * 重要：这里**不做任何 iframe 重载**。
 * 之前每次切换设置都会 reloadFrame()，用户刚贴完文字想发送时被重载一下，
 * 未发送的文字就没了 —— 这正是「看着在发送但文字没进去」的一个成因。
 * 设置变化只通过 postMessage 同步给 bridge。
 */
function applySettings() {
  el.optAutosend.checked = state.settings.autoSend;
  el.optFab.checked = state.settings.fab;
  el.optHideToolbar.checked = state.settings.hideToolbar;
  if (el.optLegacyWrite) el.optLegacyWrite.checked = state.settings.legacyWrite;
  el.statusbar.classList.toggle('hidden', state.settings.hideToolbar);

  state.pendingConfigSync = true;
  postToBridge(bridgeConfig());
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  applySettings();
  const ok = await storageSet('sync', patch);
  if (!ok) await storageSet('local', patch);
  setStatus('设置已保存', 'ok');
}

/* ------------------------------------------------------------------ */
/* 临时隐身 / 退出登录                                                */
/* ------------------------------------------------------------------ */

async function applyStealth(enabled, { reload = true } = {}) {
  const res = await send({ type: 'set-stealth', enabled });
  if (!res.ok) {
    setStatus('切换隐身模式失败：' + (res.error || '未知错误'), 'err');
    return;
  }
  state.stealth = !!res.stealth;
  el.btnStealth.setAttribute('aria-pressed', state.stealth ? 'true' : 'false');
  setStatus(state.stealth ? '临时隐身已开启（面板内 ChatGPT 处于未登录状态）' : '临时隐身已关闭', 'warn');
  if (reload) reloadFrame();
}

async function doLogout() {
  el.confirm.hidden = true;
  setStatus('正在清除 ChatGPT 登录信息…', 'warn');
  try {
    await chrome.browsingData.removeCookies({ origins: STORAGE_ORIGINS });
    setStatus('已清除 chatgpt.com / openai.com 的 Cookie，正在重新加载…', 'ok');
  } catch (err) {
    setStatus('清除失败：' + (err && err.message ? err.message : err), 'err');
    return;
  }
  reloadFrame();
}

/* ------------------------------------------------------------------ */
/* 兼容模式 / User-Agent 伪装                                         */
/* ------------------------------------------------------------------ */

async function toggleCompat(force) {
  const wantOpen = typeof force === 'boolean' ? force : !state.compatOpen;
  const res = await send({ type: wantOpen ? 'open-compat' : 'close-compat', url: CHATGPT_URL });
  state.compatOpen = wantOpen ? !!res.ok : false;
  el.btnCompat.setAttribute('aria-pressed', state.compatOpen ? 'true' : 'false');
  el.compatStrip.hidden = !state.compatOpen;
  setStatus(
    state.compatOpen
      ? '兼容模式：ChatGPT 已放入独立贴边窗口（不会随侧边栏关闭）'
      : '已退出兼容模式，恢复嵌入式面板',
    state.compatOpen ? 'ok' : 'warn'
  );
}

async function applyUaSpoof(enabled) {
  const res = await send({ type: 'set-ua-spoof', enabled });
  if (!res.ok) {
    setStatus('切换 User-Agent 伪装失败：' + (res.error || '未知错误'), 'err');
    return;
  }
  state.uaSpoof = !!res.uaSpoof;
  el.optUaSpoof.checked = state.uaSpoof;
  setStatus(state.uaSpoof ? 'User-Agent 伪装已开启，正在重载…' : 'User-Agent 伪装已关闭，正在重载…', 'warn');
  reloadFrame();
}

/* ------------------------------------------------------------------ */
/* 自检                                                              */
/* ------------------------------------------------------------------ */

async function probeHeaders() {
  setStatus('正在检查嵌入规则…', 'warn');
  const res = await send({ type: 'probe-headers', url: CHATGPT_URL });
  if (!res.ok) {
    setStatus('自检失败：' + (res.error || '未知错误'), 'err');
    return;
  }
  const lines = [];
  lines.push('HTTP ' + res.status);
  lines.push('XFO=' + (res.frameOptions || '无'));
  lines.push('CSP=' + (res.csp ? String(res.csp).slice(0, 40) : '无'));
  if (res.cfMitigated) lines.push('Cloudflare=' + res.cfMitigated);

  if (res.cfMitigated) {
    setStatus(
      '自检：Cloudflare 对本机出口返回了挑战页（' + res.cfMitigated + '），框架头已放行但站点仍在验证；' +
        '可尝试菜单里的「伪装 User-Agent」或「兼容模式」。',
      'warn'
    );
  } else if (res.frameOptions || (res.csp && /frame-ancestors/i.test(res.csp))) {
    setStatus('自检：仍存在框架拦截头（XFO=' + (res.frameOptions || '无') + '），嵌入可能失败', 'err');
  } else {
    setStatus('自检通过：' + lines.join(' · '), 'ok');
  }
}

/* ------------------------------------------------------------------ */
/* 事件绑定                                                           */
/* ------------------------------------------------------------------ */

el.frame.addEventListener('load', () => {
  // 有些情况下 ChatGPT 的脚本注入晚于 load，这里只做轻微兜底
  if (!state.ready) setStatus('已加载页面，正在等待 ChatGPT 就绪…', 'warn');
});

el.btnReload.addEventListener('click', reloadFrame);
el.btnTab.addEventListener('click', openInTab);
el.btnStealth.addEventListener('click', () => applyStealth(!state.stealth));
el.btnCompat.addEventListener('click', () => toggleCompat());
el.btnCompatBack.addEventListener('click', () => toggleCompat(false));

el.btnMenu.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = el.menu.hidden;
  el.menu.hidden = !open;
  el.btnMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
});

document.addEventListener('click', (event) => {
  if (el.menu.hidden) return;
  if (el.menu.contains(event.target)) return;
  el.menu.hidden = true;
  el.btnMenu.setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    el.menu.hidden = true;
    el.confirm.hidden = true;
    el.btnMenu.setAttribute('aria-expanded', 'false');
  }
});

el.optAutosend.addEventListener('change', () => saveSettings({ autoSend: el.optAutosend.checked }));
el.optFab.addEventListener('change', () => saveSettings({ fab: el.optFab.checked }));
el.optHideToolbar.addEventListener('change', () => saveSettings({ hideToolbar: el.optHideToolbar.checked }));
el.optLegacyWrite.addEventListener('change', () => {
  saveSettings({ legacyWrite: el.optLegacyWrite.checked });
  setStatus(
    el.optLegacyWrite.checked
      ? '已切换到兼容写入模式（insertHTML 优先），再试一次发送'
      : '已切回标准写入模式（execCommand insertText）',
    'warn'
  );
  postToBridge(bridgeConfig());
});
el.optUaSpoof.addEventListener('change', () => applyUaSpoof(el.optUaSpoof.checked));

el.btnLogout.addEventListener('click', () => {
  el.menu.hidden = true;
  el.btnMenu.setAttribute('aria-expanded', 'false');
  el.confirm.hidden = false;
});
el.btnCancelLogout.addEventListener('click', () => {
  el.confirm.hidden = true;
});
el.btnConfirmLogout.addEventListener('click', doLogout);

el.btnProbe.addEventListener('click', () => {
  el.menu.hidden = true;
  probeHeaders();
});

el.btnDiag.addEventListener('click', () => {
  el.menu.hidden = true;
  el.loading.hidden = false;
  el.loading.innerHTML = `
    <div class="overlay-card">
      <p class="overlay-title">输入框结构诊断</p>
      <p class="overlay-hint">下面是面板实际看到的页面结构，用于定位「为什么文字进不去」。</p>
      <pre id="diag-out" class="diag">正在检查…</pre>
      <div class="overlay-actions">
        <button class="btn" id="btn-diag-selftest" type="button">运行写入自检</button>
        <button class="btn" id="btn-diag-close" type="button">关闭</button>
      </div>
    </div>`;
  const closeBtn = document.getElementById('btn-diag-close');
  const selfTestBtn = document.getElementById('btn-diag-selftest');
  if (closeBtn) closeBtn.addEventListener('click', () => (el.loading.hidden = true));
  if (selfTestBtn) selfTestBtn.addEventListener('click', () => runSelfTest());
  runDiagnostics();
});

el.btnShortcut.addEventListener('click', () => {
  el.menu.hidden = true;
  const isEdge = /\bEdg\//.test(navigator.userAgent);
  const shortcutUrl = isEdge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
  chrome.tabs.create({ url: shortcutUrl }).catch(() => {
    setStatus('无法打开快捷键设置页，请手动访问 ' + shortcutUrl, 'warn');
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'pending-prompt') {
    consumePendingPrompt();
    sendResponse({ ok: true });
    return;
  }
  if (msg && msg.type === 'panel-open') {
    // 不要无脑重载：先问一句，活着就复用（重载会打断 Cloudflare 校验、也会清掉未发送的文字）
    if (!state.ready) {
      probeBridgeAlive().then((alive) => {
        if (!alive) reloadFrame();
      });
    }
    sendResponse({ ok: true });
    return;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingPrompt) consumePendingPrompt();
  if (area === 'sync' || area === 'local') {
    let touched = false;
    for (const key of ['autoSend', 'fab', 'hideToolbar', 'legacyWrite']) {
      if (changes[key] && typeof changes[key].newValue === 'boolean') {
        state.settings[key] = changes[key].newValue;
        touched = true;
      }
    }
    if (touched) applySettings();
  }
});

/* ------------------------------------------------------------------ */
/* 启动                                                              */
/* ------------------------------------------------------------------ */

(async function boot() {
  const mode = await send({ type: 'get-state' });
  if (!mode?.ok) { setStatus('侧栏初始化失败，请重新打开侧栏', 'err'); return; }
  if (!mode.experimentalEmbedded) { location.replace('stable.html'); return; }
  const manifest = chrome.runtime.getManifest();
  el.menuVersion.textContent = `版本 ${manifest.version} · 扩展 ID ${chrome.runtime.id}`;

  await loadSettings();

  const st = await send({ type: 'get-state' });
  state.stealth = !!(st && st.stealth);
  state.uaSpoof = !!(st && st.uaSpoof);
  state.compatOpen = !!(st && st.compatWindowId);
  el.btnStealth.setAttribute('aria-pressed', state.stealth ? 'true' : 'false');
  el.btnCompat.setAttribute('aria-pressed', state.compatOpen ? 'true' : 'false');
  el.compatStrip.hidden = !state.compatOpen;
  el.optUaSpoof.checked = state.uaSpoof;
  if (state.stealth) setStatus('临时隐身已开启（浏览器重启后自动失效）', 'warn');
  if (state.uaSpoof) setStatus('User-Agent 伪装已开启（浏览器重启后自动失效）', 'warn');

  /*
   * 关键优化：面板每次打开都会重新创建这个页面，但**不要**因此重新加载 iframe。
   * 先问一句「bridge 还在吗」：
   *   - 在  → 直接复用，秒开，也不会把人机验证状态冲掉
   *   - 不在 → 才真正加载
   */
  setStatus('正在连接 ChatGPT…', 'warn');
  const alive = await probeBridgeAlive();
  if (alive) {
    state.ready = true;
    el.loading.hidden = true;
    setStatus(state.stealth ? '已连接 ChatGPT（临时隐身：未登录状态）' : '已连接 ChatGPT', state.stealth ? 'warn' : 'ok');
    postToBridge(bridgeConfig());
  } else {
    reloadFrame();
  }
  consumePendingPrompt();
})();

document.getElementById('btn-stable').addEventListener('click', async () => {
  const result = await send({ type: 'set-experimental-embedded', enabled: false });
  if (result?.ok) location.replace('stable.html');
  else setStatus('切换失败：' + (result?.error || '后台没有回应'), 'err');
});
document.getElementById('btn-slow-stable').addEventListener('click', () => document.getElementById('btn-stable').click());
