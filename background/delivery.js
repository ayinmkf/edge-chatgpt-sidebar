/* Durable, serial delivery queue. Session storage survives worker suspension, not browser restart. */
globalThis.CgptDelivery = (() => {
  const KEY = 'deliveryQueueV1';
  const ALARM = 'cgpt-delivery-wakeup';
  const URL_HOME = 'https://chatgpt.com/';
  const VERSION = chrome.runtime.getManifest().version;
  const ACTIVE = new Set(['queued', 'opening-chatgpt', 'waiting-page', 'delivering']);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const errorText = (error) => String(error?.message || error);
  let lock = Promise.resolve();
  let running = false;

  function serialized(fn) {
    const result = lock.then(fn);
    lock = result.catch(() => {});
    return result;
  }
  async function read() { return (await chrome.storage.session.get(KEY))[KEY] || []; }
  async function edit(fn) {
    return serialized(async () => {
      const jobs = await read();
      const result = fn(jobs);
      await chrome.storage.session.set({ [KEY]: jobs });
      return result;
    });
  }
  async function patch(id, values) {
    return edit((jobs) => {
      const job = jobs.find((item) => item.id === id);
      if (!job) throw new Error('任务不存在');
      Object.assign(job, values, { updatedAt: Date.now() });
      return { ...job };
    });
  }
  function isChatTab(tab) {
    try { const url = new URL(tab?.pendingUrl || tab?.url); return url.origin === 'https://chatgpt.com'; }
    catch { return false; }
  }
  async function recentTab(windowId) {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.filter(isChatTab).sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0))[0] || null;
  }
  async function focus(tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  async function settings() {
    try { return await chrome.storage.sync.get({ autoSend: true, fab: true }); }
    catch { return chrome.storage.local.get({ autoSend: true, fab: true }); }
  }
  function bounded(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
      .finally(() => clearTimeout(timer));
  }
  const message = (tabId, payload, ms = 4000) => bounded(
    chrome.tabs.sendMessage(tabId, payload, { frameId: 0 }), ms, 'ChatGPT 页面未及时回应'
  );
  async function probe(tabId) {
    const status = await message(tabId, { type: 'delivery-v3-ping' });
    if (status?.version !== VERSION) throw new Error('页面内脚本版本不一致');
    return status;
  }
  async function readyTab(tabId) {
    const deadline = Date.now() + 30000;
    let injected = false;
    let lastReason = '请在 ChatGPT 完成登录或人机验证，然后重试';
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(tabId);
      if (!isChatTab(tab)) {
        if (tab.status === 'loading' && (!tab.url || tab.url === 'about:blank')) { await sleep(200); continue; }
        throw new Error('目标已离开 ChatGPT，请完成登录后重试');
      }
      if (tab.status === 'complete') {
        let status;
        try { status = await probe(tabId); }
        catch (error) {
          if (!injected) {
            await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/chatgpt-bridge.js'] });
            injected = true;
          }
          lastReason = errorText(error);
        }
        if (status?.ready) return status;
        if (status?.reason) lastReason = status.reason;
      }
      // The tabs query and messages also keep the worker alive while the page loads.
      await sleep(400);
    }
    throw new Error(lastReason);
  }
  async function run(job) {
    let dispatched = false;
    try {
      await patch(job.id, { status: 'opening-chatgpt', attempts: job.attempts + 1, error: '', retryable: false });
      let tab = job.targetTabId != null ? await chrome.tabs.get(job.targetTabId).catch(() => null) : null;
      if (!isChatTab(tab) || tab.windowId !== job.windowId) tab = await recentTab(job.windowId);
      if (!tab) tab = await chrome.tabs.create({ windowId: job.windowId, url: URL_HOME, active: true });
      await patch(job.id, { targetTabId: tab.id, status: 'waiting-page' });
      await focus(tab);
      const ready = await readyTab(tab.id);
      await patch(job.id, { status: 'delivering', bridgeVersion: ready.version });
      dispatched = true;
      // Once dispatched, never resend automatically: a lost response may still have submitted the prompt.
      const result = await message(tab.id, {
        type: 'delivery-v3-prompt', requestId: job.id, text: job.text, autoSend: job.autoSend
      }, 18000);
      if (!result || result.requestId !== job.id || result.version !== VERSION) throw new Error('投递回执不匹配');
      await patch(job.id, {
        status: result.sent ? 'sent' : result.filled ? 'filled' : result.uncertain ? 'uncertain' : 'failed',
        error: result.reason || '', retryable: result.retryable === true,
        strategy: result.strategy || '', diagnostic: result.diag || null
      });
    } catch (error) {
      await patch(job.id, {
        status: dispatched ? 'uncertain' : 'failed', retryable: !dispatched,
        error: dispatched ? '已投递但未收到完整回执，请查看 ChatGPT；为避免重复提交，不会自动重发。' : errorText(error)
      });
    }
  }
  async function pump() {
    await initialized;
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = (await read()).find((job) => job.status === 'queued');
        if (!next) break;
        await run(next);
      }
    } finally { running = false; }
    // A concurrent enqueue after the final read is either observed here or by the wakeup alarm.
    if ((await read()).some((job) => job.status === 'queued')) void pump().catch(console.error);
    else await chrome.alarms.clear(ALARM);
  }
  function kick() { void pump().catch((error) => console.error('[投递队列]', error)); }
  async function wakeup() { await chrome.alarms.create(ALARM, { periodInMinutes: 1 }); }
  const initialized = edit((jobs) => {
    // Only pre-dispatch work is safe to resume after the worker is terminated.
    for (const job of jobs) {
      if (job.status === 'delivering') Object.assign(job, {
        status: 'uncertain', retryable: false, error: '投递期间后台重启，请先查看 ChatGPT，避免重复发送。', updatedAt: Date.now()
      });
      else if (ACTIVE.has(job.status)) job.status = 'queued';
    }
  });
  initialized.then(async () => {
    if ((await read()).some((job) => ACTIVE.has(job.status))) await wakeup();
    kick();
  }).catch(console.error);
  chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) kick(); });

  return {
    isChatTab,
    async deliverToTab(tabId, text, autoSend, requestId) {
      await readyTab(tabId);
      const tab = await chrome.tabs.get(tabId);
      await focus(tab);
      return message(tabId, { type: 'delivery-v3-prompt', requestId, text, autoSend }, 18000);
    },
    async enqueue(text, source, windowId, panelResult) {
      await initialized;
      if (typeof text !== 'string' || !text.trim()) throw new Error('没有可投递的选中文本');
      if (text.length > 20000) throw new Error('选中文本超过 20,000 字符，请分段发送');
      if (!Number.isInteger(windowId) || windowId < 0) throw new Error('无法确定来源浏览器窗口');
      const prefs = await settings();
      const job = {
        id: crypto.randomUUID(), windowId, text, source, autoSend: prefs.autoSend !== false,
        status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), attempts: 0,
        targetTabId: null, panelOpened: !!panelResult?.opened, panelError: panelResult?.error || '', retryable: false
      };
      await edit((jobs) => {
        if (jobs.filter((item) => ACTIVE.has(item.status)).length >= 20) throw new Error('待发送任务过多，请稍后再试');
        while (jobs.length >= 40) {
          const index = jobs.findIndex((item) => !ACTIVE.has(item.status));
          if (index < 0) break;
          jobs.splice(index, 1);
        }
        jobs.push(job);
      });
      await wakeup();
      kick();
      return job;
    },
    async state(windowId) {
      await initialized;
      const jobs = (await read()).filter((job) => job.windowId === windowId);
      const prefs = await settings();
      return { ok: true, jobs, job: jobs.at(-1) || null, ...prefs, version: VERSION };
    },
    async retry(id, windowId) {
      await initialized;
      const original = (await read()).find((job) => job.id === id && job.windowId === windowId);
      if (!original || original.status !== 'failed' || !original.retryable) throw new Error('此任务可能已经写入，请先在 ChatGPT 页面检查，不能直接重发');
      await edit((jobs) => {
        const job = jobs.find((item) => item.id === id);
        if (job.status !== 'failed') throw new Error('任务已在处理');
        job.status = 'queued'; job.updatedAt = Date.now(); job.error = ''; job.retryable = false;
      });
      await wakeup(); kick();
      return { ok: true };
    },
    async openTarget(id, windowId) {
      await initialized;
      const job = (await read()).find((item) => item.id === id && item.windowId === windowId);
      let tab = job?.targetTabId != null ? await chrome.tabs.get(job.targetTabId).catch(() => null) : null;
      if (!isChatTab(tab) || tab.windowId !== windowId) tab = await recentTab(windowId);
      if (!tab) tab = await chrome.tabs.create({ url: URL_HOME, active: true, windowId });
      await focus(tab);
      if (job) await patch(job.id, { targetTabId: tab.id });
      return { ok: true, tabId: tab.id };
    }
  };
})();
