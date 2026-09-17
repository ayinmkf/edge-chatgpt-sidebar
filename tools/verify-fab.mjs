#!/usr/bin/env node
/**
 * 悬浮按钮（FAB）点击链路自检：用 CDP 派发真实鼠标事件，验证「选中文字 → 点按钮 → 文字送达后台」。
 *
 * 这一步专门防回归：之前有三个叠加的 bug 会让按钮点了没反应
 *   1. 宿主 div 用 all:initial 后没有 pointer-events:none，遮住了页面
 *   2. document 上的 capture 阶段 mousedown 先把按钮隐藏了，click 落空
 *   3. 点击时 currentSelection() 已被清空，取不到文本
 *
 * 用法：node tools/verify-fab.mjs
 * 退出码：0 = 全部通过
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => p && existsSync(p));

const PORT = 18202;
const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  if (!ok) failures += 1;
  console.log(`[${ok ? '通过' : '失败'}] ${name}${detail ? ' —— ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 结束所有使用指定 profile 目录的 Edge 进程。
 * child.kill() 只杀掉启动器，真正的浏览器进程是它派生的，还占着目录，
 * 所以这里按命令行里的 profile 路径精确匹配再杀。
 */
async function killEdgeFor(dir) {
  if (process.platform !== 'win32') {
    try {
      child.kill();
    } catch (err) {
      /* 忽略 */
    }
    return;
  }
  const key = String(dir).replace(/'/g, "''");
  try {
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${key}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      ],
      { stdio: 'ignore' }
    );
  } catch (err) {
    /* 忽略 */
  }
  await sleep(2500);
}

/** 尽力删除临时目录（Edge 退出后目录可能被系统短暂占用，重试几次） */
async function cleanupDir(dir) {
  if (!dir) return true;
  for (let i = 0; i < 6; i++) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      if (!existsSync(dir)) return true;
    } catch (err) {
      /* 稍后重试 */
    }
    await sleep(900);
  }
  return !existsSync(dir);
}

const pageHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Selection page</title>
<style>body{font:16px/1.8 sans-serif;margin:40px;max-width:700px}</style></head>
<body>
  <h1>选中文字测试</h1>
  <p id="para">这是一段用于测试悬浮按钮的普通段落文字，请选中我。</p>
  <p>另外一段无关内容，用于确认按钮位置不会乱跑。</p>
</body></html>`;

/* 用一个临时扩展承载 selection.js（走真实的 content script 注入路径） */
const tempRoot = mkdtempSync(join(tmpdir(), 'cgpt-fab-'));
const extDir = join(tempRoot, 'ext');
mkdirSync(extDir, { recursive: true });
writeFileSync(
  join(extDir, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 3,
      name: 'FAB Probe',
      version: '1.0',
      permissions: ['storage'],
      background: { service_worker: 'sw.js' },
      host_permissions: [`http://127.0.0.1:${PORT}/*`],
      content_scripts: [
        {
          matches: [`http://127.0.0.1:${PORT}/*`],
          js: ['selection.js'],
          run_at: 'document_idle',
          all_frames: false
        }
      ]
    },
    null,
    2
  )
);
writeFileSync(
  join(extDir, 'sw.js'),
  `// 记录页面发来的 send-to-panel 请求，供测试查询
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'send-to-panel') {
    chrome.storage.session.set({ lastSend: { text: msg.text, source: msg.source, at: Date.now() } })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});`
);
writeFileSync(join(extDir, 'selection.js'), readFileSync(join(ROOT, 'content/selection.js'), 'utf8'));

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(pageHtml);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'cgpt-fab-profile-'));

let ws = null;
let child = null;
try {
  // Edge 偶尔会被系统瞬时拦一下导致启动失败，这里最多重试 3 次
  let version = null;
  for (let attempt = 1; attempt <= 3 && !version; attempt++) {
    child = spawn(
      EDGE,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        `--load-extension=${extDir}`,
        '--disable-extensions-except=' + extDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        '--window-size=1000,800',
        'about:blank'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 120 && !version; i++) {
      if (existsSync(portFile)) {
        const first = readFileSync(portFile, 'utf8').split(/\r?\n/).filter(Boolean);
        if (first[0]) {
          version = await (await fetch(`http://127.0.0.1:${Number(first[0])}/json/version`)).json();
        }
      }
      if (!version) await sleep(120);
    }
    if (!version) {
      console.log(`第 ${attempt} 次启动 Edge 失败，重试…`);
      try {
        child.kill();
      } catch (err) {
        /* 忽略 */
      }
      await sleep(1500);
    }
  }
  if (!version) throw new Error('Edge 启动失败（已重试 3 次）');

  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = (e) => j(new Error(String(e?.message || e)));
  });

  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    return new Promise((resolveP, rejectP) => {
      pending.set(id, { resolve: resolveP, reject: rejectP });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rejectP(new Error('CDP 超时: ' + method));
        }
      }, 20000);
    });
  };

  console.log('=== 悬浮按钮点击链路自检 ===');

  let swTarget = null;
  for (let i = 0; i < 40 && !swTarget; i++) {
    const t = await send('Target.getTargets');
    swTarget = t.targetInfos.find((x) => x.type === 'service_worker' && String(x.url).includes('/sw.js'));
    if (!swTarget) await sleep(400);
  }
  const extId = swTarget ? new URL(swTarget.url).host : '';

  /*
   * MV3 的 service worker 闲置后会被浏览器停掉。
   * 这里用 CDP 显式把它唤醒并挂上调试器（调试期间不会被停），
   * 以便把「扩展逻辑」和「浏览器 SW 生命周期」两件事分开测。
   */
  let swSessionId = null;
  try {
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await send('Runtime.enable', {}, swSessionId || undefined).catch(() => null);
    for (let i = 0; i < 30 && !swSessionId; i++) {
      const t = await send('Target.getTargets');
      const sw = t.targetInfos.find((x) => x.type === 'service_worker' && String(x.url).includes('/sw.js'));
      if (sw) {
        const att = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
        swSessionId = att.sessionId;
        swTarget = sw;
      } else {
        await sleep(200);
      }
    }
  } catch (err) {
    console.log('  （唤醒 service worker 失败：' + String(err?.message || err) + '）');
  }
  if (swSessionId) {
    await send('Runtime.runIfWaitingForDebugger', {}, swSessionId).catch(() => null);
    await send('Runtime.enable', {}, swSessionId).catch(() => null);
  }
  console.log('  （service worker 已唤醒并挂上调试器：' + !!swSessionId + '）');

  const page = await send('Target.createTarget', { url: `http://127.0.0.1:${PORT}/` });
  const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sid = attached.sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.enable', {}, sid);
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false }, sid);
  await sleep(2500);

  /* 1. 用程序选中段落文字（模拟真人拖选结束后的状态） */
  const sel = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const p = document.getElementById('para');
        const range = document.createRange();
        range.selectNodeContents(p);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return s.toString();
      })()`,
      returnByValue: true
    },
    sid
  );
  check('页面文字已选中', String(sel.result.value || '').length > 5, JSON.stringify(sel.result.value));

  /* 2. 悬浮按钮应该出现，并取到它的位置 */
  await sleep(900);
  const fabInfo = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.getElementById('__cgpt_sidepanel_host__');
        if (!host || !host.shadowRoot) return JSON.stringify({ found: false });
        const btn = host.shadowRoot.querySelector('.fab');
        if (!btn) return JSON.stringify({ found: false });
        const r = btn.getBoundingClientRect();
        return JSON.stringify({
          found: true,
          shown: btn.classList.contains('show'),
          text: btn.textContent.trim(),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          w: Math.round(r.width),
          h: Math.round(r.height),
          hostPointerEvents: getComputedStyle(host).pointerEvents,
          fabPointerEvents: getComputedStyle(btn).pointerEvents
        });
      })()`,
      returnByValue: true
    },
    sid
  );
  const fab = JSON.parse(fabInfo.result.value || '{}');
  check('悬浮按钮已显示', fab.found === true && fab.shown === true, JSON.stringify(fab));
  check('按钮文案正确', /问 ChatGPT/.test(String(fab.text || '')), JSON.stringify(fab.text));
  check('宿主容器不遮挡页面点击（pointer-events:none）', fab.hostPointerEvents === 'none', 'host=' + fab.hostPointerEvents);
  check('按钮本身可点击（pointer-events:auto）', fab.fabPointerEvents === 'auto', 'fab=' + fab.fabPointerEvents);
  check('按钮位置在页面上而非 (0,0)', fab.x > 0 && fab.y > 0, `x=${fab.x} y=${fab.y}`);

  /* 3. 用真实鼠标事件点击按钮 */
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fab.x, y: fab.y, button: 'none' }, sid);
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fab.x, y: fab.y, button: 'left', clickCount: 1 }, sid);
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fab.x, y: fab.y, button: 'left', clickCount: 1 }, sid);
  await sleep(1200);

  /* 4. 后台是否真的收到了内容（轮询等一会儿，MV3 的 SW 可能刚被唤醒） */
  let lastSend = null;
  if (swTarget) {
    const swAttached = swSessionId
      ? { sessionId: swSessionId }
      : await send('Target.attachToTarget', { targetId: swTarget.targetId, flatten: true });
    for (let i = 0; i < 10 && !lastSend; i++) {
      const got = await send(
        'Runtime.evaluate',
        {
          expression: 'chrome.storage.session.get("lastSend").then(d => JSON.stringify(d.lastSend || null))',
          awaitPromise: true,
          returnByValue: true
        },
        swAttached.sessionId
      ).catch(() => null);
      try {
        lastSend = JSON.parse(got?.result?.value || 'null');
      } catch (err) {
        lastSend = null;
      }
      if (!lastSend) await sleep(400);
    }
  }
  let diag = null;
  try {
    const calls = await send(
      'Runtime.evaluate',
      {
        expression: "document.documentElement.getAttribute('data-cgpt-selection-diag')",
        returnByValue: true
      },
      sid
    );
    diag = JSON.parse(calls.result.value || 'null');
  } catch (err) {
    console.log('  （读取诊断失败：' + String(err && err.message ? err.message : err) + '）');
  }
  console.log('  （悬浮按钮内部诊断：' + JSON.stringify(diag) + '）');
  check(
    '点击悬浮按钮后，选中文本已送达后台',
    !!lastSend && String(lastSend.text || '').includes('悬浮按钮'),
    JSON.stringify(lastSend)
  );

  /* 5. 默认链路会给出短暂的“正在发送”反馈，提示结束后才收起。 */
  await sleep(400);
  const after = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.getElementById('__cgpt_sidepanel_host__');
        const btn = host && host.shadowRoot ? host.shadowRoot.querySelector('.fab') : null;
        return JSON.stringify({ shown: btn ? btn.classList.contains('show') : null });
      })()`,
      returnByValue: true
    },
    sid
  );
  const afterClick = JSON.parse(after.result.value || '{}');
  check('点击后显示投递状态反馈', afterClick.shown === true, after.result.value);
  await sleep(2300);
  const hidden = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.getElementById('__cgpt_sidepanel_host__');
        const btn = host && host.shadowRoot ? host.shadowRoot.querySelector('.fab') : null;
        return JSON.stringify({ shown: btn ? btn.classList.contains('show') : null });
      })()`,
      returnByValue: true
    },
    sid
  );
  check('投递反馈结束后按钮自动收起', JSON.parse(hidden.result.value || '{}').shown === false, hidden.result.value);

  /* 6. 再选一次，应该还能用（防止“用一次就失效”） */
  await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const p = document.getElementById('para');
        const range = document.createRange();
        range.selectNodeContents(p);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return 'ok';
      })()`,
      returnByValue: true
    },
    sid
  );
  await sleep(900);
  const again = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const host = document.getElementById('__cgpt_sidepanel_host__');
        const btn = host && host.shadowRoot ? host.shadowRoot.querySelector('.fab') : null;
        const r = btn ? btn.getBoundingClientRect() : null;
        return JSON.stringify({ shown: btn ? btn.classList.contains('show') : null, x: r ? Math.round(r.left + r.width/2) : 0, y: r ? Math.round(r.top + r.height/2) : 0 });
      })()`,
      returnByValue: true
    },
    sid
  );
  const fab2 = JSON.parse(again.result.value || '{}');
  check('再次选中后按钮仍能弹出（可重复使用）', fab2.shown === true, again.result.value);

  void extId;
} catch (err) {
  check('自检脚本执行未抛异常', false, String(err && err.message ? err.message : err));
} finally {
  try {
    if (ws) ws.close();
  } catch (err) {
    /* 忽略 */
  }
  child.kill();
  server.close();
  await killEdgeFor(profile);
  const ok1 = await cleanupDir(profile);
  const ok2 = await cleanupDir(tempRoot);
  if (!ok1 || !ok2) {
    console.log('（部分临时目录未能自动删除：' + profile + ' / ' + tempRoot + '）');
  }
}

console.log('');
console.log(`=== 结果：${results.length - failures} 项通过，${failures} 项失败 ===`);
process.exit(failures ? 1 : 0);
