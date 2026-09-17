import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(80); }
  throw Error('等待条件超时');
}
export async function startEdge(htmlForUrl) {
  const edge = [process.env.EDGE_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((path) => path && existsSync(path));
  if (!edge) throw Error('未找到 Edge，可通过 EDGE_PATH 指定路径');
  const root = mkdtempSync(join(tmpdir(), 'cgpt-stable-test-'));
  const ext = join(root, 'extension');
  for (const path of ['manifest.json', 'background', 'content', 'panel', 'rules', 'icons']) cpSync(join(ROOT, path), join(ext, path), { recursive: true });
  const profile = join(root, 'profile');
  const child = spawn(edge, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-sync', '--window-size=1200,900', '--remote-debugging-port=0',
    '--no-proxy-server', '--host-resolver-rules=MAP chatgpt.com ~NOTFOUND',
    '--user-data-dir=' + profile, '--load-extension=' + ext, '--disable-extensions-except=' + ext, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let ws;
  const pending = new Map();
  const sessions = new Map();
  const errors = [];
  let counter = 1;
  const handlers = new Set();
  function send(method, params = {}, sessionId) {
    const id = counter++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 40000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function evaluate(sessionId, expression, userGesture = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  async function onEvent(message) {
    if (message.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = message.params;
      sessions.set(targetInfo.targetId, { ...targetInfo, sessionId });
      await send('Runtime.enable', {}, sessionId);
      if (targetInfo.type === 'page' || targetInfo.type === 'iframe' || targetInfo.type === 'other') {
        await send('Fetch.enable', { patterns: [{ urlPattern: 'https://chatgpt.com/*' }] }, sessionId);
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      }
      await send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      // tabs.create can start its navigation before target attachment. Restart that initial
      // request after Fetch is installed; DNS for the real site is disabled in this profile.
      if (targetInfo.type === 'page' && targetInfo.url.startsWith('https://chatgpt.com/')) {
        await send('Page.navigate', { url: targetInfo.url }, sessionId);
      }
    } else if (message.method === 'Target.targetInfoChanged') {
      const target = message.params.targetInfo;
      const current = sessions.get(target.targetId);
      if (current) sessions.set(target.targetId, { ...current, ...target });
    } else if (message.method === 'Fetch.requestPaused') {
      const { request, requestId } = message.params;
      const body = htmlForUrl(request.url);
      await send('Fetch.fulfillRequest', {
        requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(body).toString('base64')
      }, message.sessionId);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  }
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    await until(() => existsSync(portFile), 20000);
    const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const info = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
    ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const call = pending.get(data.id); pending.delete(data.id); clearTimeout(call.timer);
        if (data.error) call.reject(Error(data.error.message)); else call.resolve(data.result);
      } else if (data.method) {
        const work = onEvent(data).catch((error) => {
          // OOPIF navigation legitimately detaches the old target while setup is still in flight.
          if (!/Session with given id not found|Target closed|No target with given id/i.test(String(error))) errors.push(String(error));
        });
        handlers.add(work); work.finally(() => handlers.delete(work));
      }
    };
    await send('Target.setDiscoverTargets', { discover: true });
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const worker = await until(async () => {
      const targets = (await send('Target.getTargets')).targetInfos;
      const target = targets.find((item) => item.type === 'service_worker' && item.url.endsWith('/background/service-worker.js'));
      if (!target) return null;
      if (!sessions.has(target.targetId)) await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      return sessions.get(target.targetId);
    });
    const extensionId = new URL(worker.url).host;
    await until(async () => {
      try { return await evaluate(worker.sessionId, 'typeof chrome !== "undefined" && !!chrome.runtime?.id'); }
      catch { return false; }
    });
    async function page(url) {
      const target = await send('Target.createTarget', { url });
      const entry = await until(() => sessions.get(target.targetId));
      await until(async () => {
        try { return await evaluate(entry.sessionId, 'location.href === ' + JSON.stringify(url) + ' && document.readyState === "complete" && !!document.documentElement'); }
        catch { return false; }
      });
      return entry;
    }
    return { send, evaluate, page, sessions, errors, worker, extensionId, root,
      async close() {
        try { await send('Browser.close'); } catch {}
        ws.close();
        await sleep(500);
        child.kill();
        for (const call of pending.values()) { clearTimeout(call.timer); call.reject(Error('test finished')); }
        pending.clear();
        // Only this generated temporary directory can be removed.
        const rel = relative(tmpdir(), root);
        if (!rel.startsWith('..') && rel.startsWith('cgpt-stable-test-')) {
          try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
          catch { console.log('临时测试目录保留：' + root); }
        }
      }
    };
  } catch (error) { ws?.close(); child.kill(); throw error; }
}
