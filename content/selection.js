/**
 * ChatGPT 侧边栏 —— 网页侧脚本
 *
 * 作用：在普通网页上选中文字后：
 *  1. 显示一个悬浮小按钮，点击即可把选中内容发到侧边栏（可在面板菜单里关闭）
 *  2. 右键菜单「发送选中内容到 ChatGPT 侧边栏」由后台处理，这里不重复处理
 *
 * 该脚本不会运行在 chatgpt.com / openai.com 上（见 manifest 的 exclude_matches）。
 */

(function () {
  'use strict';

  if (window.__cgptSelectionHelper) return;
  window.__cgptSelectionHelper = true;

  const HOST_ID = '__cgpt_sidepanel_host__';
  const MIN_LENGTH = 2;
  const MAX_LENGTH = 20000;

  const { defaults, normalize, key } = SidebarAppearance;
  let appearance = normalize();
  function applyAppearance() {
    if (!fab) return;
    fab.style.background = appearance.background;
    fab.style.borderColor = appearance.background;
    fab.style.color = appearance.foreground;
    fab.querySelector('img').src = appearance.icon || chrome.runtime.getURL(defaults.iconPath);
    fab.querySelector('span').textContent = appearance.label;
  }
  chrome.storage.local.get(key).then(data => { appearance = normalize(data[key]); applyAppearance(); }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) { appearance = normalize(changes[key].newValue); applyAppearance(); }
  });
  let host = null;
  let shadow = null;
  let fab = null;
  let hideTimer = 0;
  let hintTimer = 0;
  let keepFabTimer = 0;
  let fabEnabled = true;
  let keepFab = false; // 正在点击悬浮按钮时，不让「点击页面」的逻辑把它隐藏掉
  let pendingFabText = ''; // mousedown 那一刻的选中文本
  let sending = false;
  let lastSelectionText = '';

  /**
   * 轻量诊断记录：方便出问题时快速看出「哪一步断了」。
   * 内容脚本跑在隔离世界，window 上的东西页面读不到，所以同时挂一份到 DOM 元素上。
   */
  const diag = { clicks: 0, sent: 0, lastText: '', lastError: '', events: [] };
  function note(event, detail) {
    diag.events.push({ at: Date.now(), event, detail: detail == null ? '' : String(detail).slice(0, 80) });
    if (diag.events.length > 30) diag.events.shift();
    publishDiag();
  }
  function publishDiag() {
    try {
      window.__cgptSelectionDiag = diag;
    } catch (err) {
      /* 忽略 */
    }
    try {
      const el = document.documentElement;
      if (el) el.setAttribute('data-cgpt-selection-diag', JSON.stringify(diag));
    } catch (err) {
      /* 忽略 */
    }
  }
  note('init');

  /* ---------------------------- 设置同步 ---------------------------- */

  function readSettings() {
    try {
      chrome.storage.sync.get({ fab: true }, (data) => {
        if (chrome.runtime.lastError) {
          readLocalSettings();
          return;
        }
        fabEnabled = data.fab !== false;
      });
    } catch (err) {
      readLocalSettings();
    }
  }

  function readLocalSettings() {
    try {
      chrome.storage.local.get({ fab: true }, (data) => {
        if (chrome.runtime.lastError) return;
        fabEnabled = data.fab !== false;
      });
    } catch (err) {
      /* 忽略 */
    }
  }

  readSettings();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'sync' || area === 'local') && changes.fab) {
        fabEnabled = changes.fab.newValue !== false;
        if (!fabEnabled) hideFab();
      }
    });
  } catch (err) {
    /* 忽略 */
  }

  /* ---------------------------- UI ---------------------------- */

  function ensureUi() {
    if (host && document.documentElement.contains(host)) return true;
    if (!document.body) return false;

    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        /*
         * 关键：宿主 div 用 all:initial 后不能吃掉页面点击。
         * pointer-events:none 让宿主透明，只有按钮本身接收事件。
         */
        .fab {
          position: fixed;
          display: none;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border: 1px solid rgba(16, 163, 127, 0.55);
          border-radius: 999px;
          background: #10a37f;
          color: #fff;
          font: 600 12px/1 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          pointer-events: auto;
          z-index: 2147483647;
        }
        .fab.show { display: inline-flex; }
        .fab:active { transform: translateY(1px); }
        .fab img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; pointer-events: none; }
        .fab { max-width: calc(100vw - 16px); box-sizing: border-box; }
        .fab img { flex: 0 0 auto; }
        .fab span { pointer-events: none; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="fab" role="button" tabindex="0" title="发送选中内容到 ChatGPT 侧边栏">
        <img class="personal-icon" alt="">
        <span>问 ChatGPT</span>
      </div>`;

    fab = shadow.querySelector('.fab');
    applyAppearance();

    /*
     * 关键：宿主容器不接收指针事件，避免遮住页面本身的点击。
     * （之前 .fab 的点击会被 document 上的 capture 阶段 mousedown 先清掉，
     *   见下面 keepFab 的处理。）
     */
    host.style.pointerEvents = 'none';

    fab.addEventListener('mousedown', (event) => {
      // 让按钮自己的点击不被「点击页面就隐藏按钮」的逻辑吃掉，
      // 并顺手记下当前选区（这一刻选区一定还在）
      keepFab = true;
      // 兜底：即使 click 因为任何原因没触发，400ms 后也要解除保护，避免按钮变成“点不动”
      clearTimeout(keepFabTimer);
      keepFabTimer = setTimeout(() => (keepFab = false), 400);
      const info = currentSelection();
      pendingFabText = info ? info.text : '';
      event.preventDefault();
      event.stopPropagation();
    });
    fab.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(keepFabTimer);
      keepFab = false;
      onFabClick();
    });
    fab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onFabClick();
      }
    });
    fab.addEventListener('mouseenter', () => clearTimeout(hideTimer));

    document.documentElement.appendChild(host);
    return true;
  }

  function showFab(rect) {
    if (!fabEnabled) return;
    if (!ensureUi()) return;
    clearTimeout(hideTimer);
    clearTimeout(hintTimer);
    fab.querySelector('span').textContent = appearance.label;

    fab.classList.add('show');
    const width = fab.getBoundingClientRect().width || 118;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 8
    );
    const top = rect.top - 34 < 8 ? rect.bottom + 8 : rect.top - 34;

    fab.style.left = Math.round(left) + 'px';
    fab.style.top = Math.round(top) + 'px';
    fab.classList.add('show');
  }

  function hideFab() {
    if (fab) fab.classList.remove('show');
  }

  /* ---------------------------- 选区处理 ---------------------------- */

  function currentSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = String(selection.toString() || '').trim();
    if (text.length < MIN_LENGTH) return null;
    let rect = null;
    try {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    } catch (err) {
      return null;
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect };
  }

  function onSelectionChange() {
    if (sending) return;
    const info = currentSelection();
    if (!info) {
      hideFab();
      return;
    }
    // 用户正在拖选时先不打扰
    if (isSelecting) return;
    showFab(info.rect);
  }

  let isSelecting = false;

  document.addEventListener(
    'mousedown',
    (event) => {
      // 点在悬浮按钮上（宿主容器在 shadow DOM 里，target 是 host 元素）时不要隐藏它
      if (keepFab || (host && event.target === host)) return;
      isSelecting = true;
      hideFab();
    },
    true
  );

  document.addEventListener(
    'mouseup',
    (event) => {
      if (keepFab || (host && event.target === host)) return;
      isSelecting = false;
      setTimeout(onSelectionChange, 30);
    },
    true
  );

  document.addEventListener('scroll', hideFab, true);
  document.addEventListener('keyup', (event) => {
    if (event.key === 'Escape') hideFab();
  });

  // 键盘选择（Shift+方向键 / Ctrl+A）也要能触发悬浮按钮
  let selectionTimer = 0;
  document.addEventListener('selectionchange', () => {
    if (isSelecting) return;
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(onSelectionChange, 250);
  });

  /* ---------------------------- 发送 ---------------------------- */

  function sendToPanel(text, source) {
    sending = true;
    setStatusHint('正在打开侧栏…', 10000);
    try {
      chrome.runtime.sendMessage({ type: 'send-to-panel', text, source }, (response) => {
        sending = false;
        const err = chrome.runtime.lastError;
        if (err || !response?.ok) {
          diag.lastError = String(err?.message || response?.error || '后台没有确认');
          note('send-error', diag.lastError);
          setStatusHint(/invalidated/i.test(diag.lastError) ? '扩展已更新，请刷新网页后重试' : '投递失败，点击此处复制文本', 6000);
        } else {
          diag.sent += 1;
          note('sent', source + ':' + text.length);
          lastSelectionText = '';
          setStatusHint(response.opened === false ? '已排队，请点击工具栏打开侧栏' : '已进入投递队列', 2200);
        }
      });
    } catch (err) {
      diag.lastError = String(err && err.message ? err.message : err);
      sending = false;
      note('send-throw', diag.lastError);
      setStatusHint('扩展已更新，请刷新网页；点击此处复制文本', 6000);
    }
  }
  function onFabClick() {
    if (sending) return;
    if (lastSelectionText && fab?.querySelector('span').textContent.includes('复制文本')) {
      navigator.clipboard.writeText(lastSelectionText).then(
        () => setStatusHint('已复制文本'),
        () => setStatusHint('复制未获允许，请用 Ctrl+C 复制选区')
      );
      return;
    }
    diag.clicks += 1;
    // 优先用「按下按钮那一刻」记下的选区，避免某些页面上选区在点击过程中被清掉
    const info = currentSelection();
    const text = pendingFabText || (info ? info.text : '');
    pendingFabText = '';
    diag.lastText = text ? text.slice(0, 60) : '';
    note('click', text ? text.length + ' chars' : 'no-text');
    hideFab();
    if (!text) {
      setStatusHint('没有取到选中内容，请重新选中后再点');
      return;
    }

    if (text.length > MAX_LENGTH) {
      setStatusHint('内容超过 20,000 字符，请分段发送', 4000);
      return;
    }
    lastSelectionText = text;
    sendToPanel(text, 'page-fab');
  }

  /** 短暂提示（复用悬浮按钮的位置，避免用 alert 打断） */
  function setStatusHint(message, duration = 2200) {
    if (!fab) return;
    fab.querySelector('span').textContent = message;
    fab.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (fab) fab.querySelector('span').textContent = appearance.label;
      hideFab();
    }, duration);
  }
})();
