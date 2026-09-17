/**
 * ChatGPT editor adapter. Runtime messages are accepted only in the top frame;
 * the experimental iframe retains an origin-checked postMessage interface.
 */
(() => {
  'use strict';
  const VERSION = '0.3.1';
  const embedded = window.top !== window.self;
  const previous = window.__cgptDeliveryBridge;
  if (previous?.version === VERSION) return;
  previous?.dispose?.();
  const cache = new Map();
  let busy = false;
  let config = { autoSend: true, legacyWrite: false };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (text) => String(text || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/g, '');
  const INPUTS = ['#prompt-textarea', '.ProseMirror[contenteditable="true"]', 'form [contenteditable="true"][role="textbox"]', 'textarea[data-id]', 'form textarea'];
  const SENDS = ['#composer-submit-button', 'button[data-testid="send-button"]', 'button[data-testid="fruitjuice-send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="发送提示"]', 'button[aria-label="发送"]', 'button[aria-label="Send"]'];

  function visible(node) {
    if (!node?.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' &&
      style.opacity !== '0' && node.getAttribute('aria-hidden') !== 'true';
  }
  function findInput() {
    for (const selector of INPUTS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node) || node.disabled || node.readOnly || node.getAttribute('aria-disabled') === 'true') continue;
        if (node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true') return node;
      }
    }
    return null;
  }
  function read(node = findInput()) {
    return normalize(node?.tagName === 'TEXTAREA' ? node.value : node?.innerText || '');
  }
  function generating() {
    return [...document.querySelectorAll('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="停止生成"]')].some(visible);
  }
  function findSend(input) {
    const root = input?.closest('form') || document;
    for (const selector of SENDS) {
      for (const button of root.querySelectorAll(selector)) {
        const identity = (button.getAttribute('data-testid') || '') + ' ' + (button.getAttribute('aria-label') || '');
        if (/stop|停止|voice|语音/i.test(identity)) continue;
        if (visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
      }
    }
    return null;
  }
  function diag() {
    const input = findInput();
    return {
      version: VERSION, host: location.hostname, readyState: document.readyState,
      input: input ? { tag: input.tagName, id: input.id, textLength: read(input).length } : null,
      sendButton: !!findSend(input), generating: generating()
    };
  }
  function probe() {
    const input = findInput();
    return {
      version: VERSION, ready: !!input && !generating(),
      reason: !input ? '未找到可用输入框，请完成 ChatGPT 登录或人机验证后重试' :
        generating() ? 'ChatGPT 正在回复，请等待回复结束后重试' : '',
      diag: diag()
    };
  }
  function placeCaret(input) {
    input.focus({ preventScroll: true });
    if (input.tagName === 'TEXTAREA') {
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      const range = document.createRange();
      range.selectNodeContents(input); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
  }
  function insert(input, text) {
    placeCaret(input);
    if (input.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'textarea';
    }
    const html = () => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const commands = config.legacyWrite ? ['insertHTML', 'insertText'] : ['insertText', 'insertHTML'];
    for (const command of commands) {
      placeCaret(input);
      if (command === 'insertText') {
        // Explicit line breaks avoid Chromium's nested <div><br></div> blank-line expansion.
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          placeCaret(input);
          if (i) document.execCommand('insertLineBreak', false);
          if (lines[i]) document.execCommand('insertText', false, lines[i]);
        }
      } else document.execCommand(command, false, html());
      if (read(input)) return command;
    }
    return 'unsupported';
  }
  async function fill(text, autoSend) {
    const input = findInput();
    if (!input || generating()) return { ok: false, filled: false, retryable: true, reason: probe().reason, diag: diag() };
    if (read(input).trim()) {
      return { ok: false, filled: false, retryable: true, reason: '输入框已有草稿，请先发送或清空草稿，再重试本任务', diag: diag() };
    }
    const expected = normalize(text);
    const strategy = insert(input, expected);
    // Re-query on every sample: React can replace the editor node after inserting text.
    for (let i = 0; i < 6; i++) {
      await pause(150);
      if (read() !== expected) {
        return { ok: false, filled: false, retryable: !read(), uncertain: !!read(), strategy,
          reason: '编辑器未完整保留文本，请查看输入框后重试', diag: diag() };
      }
    }
    if (!autoSend) return { ok: true, filled: true, sent: false, strategy };
    let button = null;
    for (let i = 0; i < 25; i++) {
      if (read() !== expected) return { ok: false, uncertain: true, filled: false, reason: '发送前输入内容发生变化，已停止自动提交', diag: diag() };
      button = findSend(findInput());
      if (button && !generating()) break;
      await pause(120);
    }
    if (!button || generating()) {
      return { ok: true, filled: true, sent: false, strategy, reason: '已填入，但发送按钮尚不可用，请手动发送' };
    }
    const before = new Set(document.querySelectorAll('[data-message-author-role="user"]'));
    button.click();
    for (let i = 0; i < 35; i++) {
      await pause(120);
      const accepted = [...document.querySelectorAll('[data-message-author-role="user"]')]
        .some((node) => !before.has(node) && normalize(node.innerText).includes(expected));
      if (accepted || (!read() && generating())) return { ok: true, sent: true, filled: true, strategy, via: 'button' };
    }
    if (read() === expected) {
      return { ok: true, sent: false, filled: true, strategy, reason: '已填入，但页面未确认提交，请手动检查发送' };
    }
    return { ok: false, sent: false, filled: false, uncertain: true, retryable: false, strategy, reason: '发送状态未确认，请查看 ChatGPT；不会自动重发', diag: diag() };
  }
  function deliver(data) {
    const id = String(data.requestId || '');
    if (cache.has(id)) return cache.get(id);
    if (!id || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 20000) {
      return Promise.resolve({ ok: false, retryable: true, filled: false, reason: '无效的投递内容', requestId: id, version: VERSION });
    }
    if (busy) return Promise.resolve({ ok: false, filled: false, retryable: true, reason: '输入框正在处理另一条任务', requestId: id, version: VERSION });
    busy = true;
    const promise = fill(data.text, data.autoSend ?? config.autoSend)
      .catch((error) => ({ ok: false, uncertain: true, filled: false, retryable: false, reason: String(error?.message || error), diag: diag() }))
      .then((result) => {
        busy = false;
        if (result.retryable) cache.delete(id);
        while (cache.size > 80) cache.delete(cache.keys().next().value);
        return { ...result, requestId: id, version: VERSION };
      });
    cache.set(id, promise);
    return promise;
  }
  function onRuntime(data, sender, respond) {
    if (embedded || sender.id !== chrome.runtime.id) return false;
    if (data?.type === 'delivery-v3-ping') { respond(probe()); return false; }
    if (data?.type === 'delivery-v3-prompt') { deliver(data).then(respond); return true; }
    return false;
  }
  const panelOrigin = (() => {
    try { return 'chrome-extension://' + chrome.runtime.id; } catch { return ''; }
  })();
  function reply(payload) {
    window.parent.postMessage({ source: 'cgpt-sidepanel-bridge', bridgeVersion: VERSION, ...payload }, panelOrigin);
  }
  function onWindow(event) {
    if (!embedded || event.source !== window.parent || event.origin !== panelOrigin || !panelOrigin) return;
    const data = event.data;
    if (data?.source !== 'cgpt-sidepanel-panel') return;
    if (data.type === 'ping') reply({ type: 'bridge-ready', requestId: data.requestId });
    if (data.type === 'config') config = { autoSend: data.autoSend !== false, legacyWrite: data.legacyWrite === true };
    if (data.type === 'diag') reply({ type: 'diag-result', requestId: data.requestId, diag: diag() });
    if (data.type === 'self-test') reply({
      type: 'self-test-result', requestId: data.requestId,
      report: { ok: !!findInput(), steps: ['仅检查输入框结构，避免改动现有草稿。'], ...diag() }
    });
    if (data.type === 'prompt') deliver(data).then((result) => reply({ type: 'prompt-result', ...result }));
  }
  chrome.runtime.onMessage.addListener(onRuntime);
  window.addEventListener('message', onWindow);
  let ticks = 0;
  const heartbeat = embedded ? setInterval(() => {
    reply({ type: 'bridge-ready' }); if (++ticks >= 8) clearInterval(heartbeat);
  }, 2500) : null;
  window.__cgptSidepanelBridge = true; // legacy diagnostic indicator
  window.__cgptDeliveryBridge = {
    version: VERSION,
    dispose() {
      chrome.runtime.onMessage.removeListener(onRuntime);
      window.removeEventListener('message', onWindow);
      clearInterval(heartbeat);
    }
  };
})();
