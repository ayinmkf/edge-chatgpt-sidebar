import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(fileURLToPath(new URL('../background/delivery.js', import.meta.url)), 'utf8');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KEY = 'deliveryQueueV1';
let passed = 0;
const clone = (value) => structuredClone(value);
const event = () => ({ addListener() {}, removeListener() {} });
function setup(options = {}) {
  const data = clone(options.storage || {});
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let noReceiver = options.noReceiver;
  const tabs = clone(options.tabs || [{ id: 1, windowId: 7, url: 'https://chatgpt.com/', status: 'complete', lastAccessed: 5 }]);
  const chrome = {
    runtime: { getManifest: () => ({ version: '0.3.1' }) },
    storage: {
      session: {
        async get(key) { return clone({ [key]: data[key] }); },
        async set(value) { Object.assign(data, clone(value)); }
      },
      sync: { async get(defaults) { return { ...defaults, autoSend: options.autoSend !== false }; } }
    },
    alarms: { async create() {}, async clear() {}, onAlarm: event() },
    windows: { async update(id) { calls.push(['window', id]); } },
    scripting: { async executeScript() { calls.push(['inject']); noReceiver = false; } },
    tabs: {
      async query({ windowId }) { return clone(tabs.filter((tab) => tab.windowId === windowId)); },
      async get(id) { const tab = tabs.find((tab) => tab.id === id); if (!tab) throw Error('closed'); return clone(tab); },
      async create(opts) { const tab = { ...opts, id: 99, status: 'complete' }; tabs.push(tab); calls.push(['create', opts]); return clone(tab); },
      async update(id) { calls.push(['focus', id]); },
      async sendMessage(id, payload, target) {
        assert.equal(target.frameId, 0);
        if (payload.type === 'delivery-v3-ping') {
          if (noReceiver) throw Error('Receiving end does not exist');
          return { ready: true, version: '0.3.1' };
        }
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        calls.push(['deliver', id, payload]); await pause(10); inFlight--;
        if (options.dropReply) throw Error('channel closed');
        return { ok: true, sent: payload.autoSend, filled: true, ...options.result, requestId: payload.requestId, version: '0.3.1' };
      }
    }
  };
  const context = vm.createContext({ chrome, crypto: { randomUUID }, console, URL, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return { api: context.CgptDelivery, data, calls, get maxInFlight() { return maxInFlight; } };
}
async function finished(test) {
  for (let i = 0; i < 300; i++) {
    const jobs = test.data[KEY] || [];
    if (jobs.length && jobs.every((job) => !['queued', 'opening-chatgpt', 'waiting-page', 'delivering'].includes(job.status))) return jobs;
    await pause(10);
  }
  throw Error('queue did not settle');
}
async function check(name, fn) { await fn(); passed++; console.log('[通过] ' + name); }
await check('连续点击不会覆盖任务；串行投递，无并发写入', async () => {
  const t = setup(); await Promise.all(['甲', '乙', '丙'].map((text) => t.api.enqueue(text, 'test', 7, { opened: true })));
  const jobs = await finished(t); assert.equal(jobs.length, 3); assert(jobs.every((job) => job.status === 'sent')); assert.equal(t.maxInFlight, 1);
});
await check('仅选择来源窗口最近的 chatgpt.com，不选 OpenAI 登录页或其他窗口', async () => {
  const t = setup({ tabs: [
    { id: 1, windowId: 7, url: 'https://chatgpt.com/', status: 'complete', lastAccessed: 1 },
    { id: 2, windowId: 7, url: 'https://chatgpt.com/c/test', status: 'complete', lastAccessed: 2 },
    { id: 3, windowId: 8, url: 'https://chatgpt.com/', status: 'complete', lastAccessed: 999 },
    { id: 4, windowId: 7, url: 'https://auth.openai.com/', status: 'complete', lastAccessed: 9999 }
  ] });
  await t.api.enqueue('A', 'test', 7); await finished(t); assert.equal(t.calls.find((call) => call[0] === 'deliver')[1], 2);
  assert.equal((await t.api.state(8)).jobs.length, 0);
});
await check('没有目标时在来源窗口创建；仅填入设置在入队时保存', async () => {
  const t = setup({ tabs: [], autoSend: false }); await t.api.enqueue('A', 'test', 7); const jobs = await finished(t);
  assert.equal(t.calls.find((call) => call[0] === 'create')[1].windowId, 7); assert.equal(jobs[0].status, 'filled');
});
await check('旧页面缺少接收器时只补注入一次，然后投递', async () => {
  const t = setup({ noReceiver: true }); await t.api.enqueue('A', 'test', 7); await finished(t);
  assert.equal(t.calls.filter((call) => call[0] === 'inject').length, 1); assert.equal(t.calls.filter((call) => call[0] === 'deliver').length, 1);
});
await check('回执丢失不自动重复发送，保留目标和未确认状态', async () => {
  const t = setup({ dropReply: true }); const job = await t.api.enqueue('A', 'test', 7); const jobs = await finished(t);
  assert.equal(jobs[0].status, 'uncertain'); assert.equal(jobs[0].targetTabId, 1);
  await assert.rejects(t.api.retry(job.id, 7)); assert.equal(t.calls.filter((call) => call[0] === 'deliver').length, 1);
});
await check('发送前的可恢复失败允许重试，成功任务禁止误重发', async () => {
  const result = { ok: false, sent: false, filled: false, retryable: true, reason: 'draft' };
  const t = setup({ result }); const job = await t.api.enqueue('A', 'test', 7); await finished(t);
  result.ok = true; result.sent = true; result.retryable = false;
  await t.api.retry(job.id, 7); const jobs = await finished(t); assert.equal(jobs[0].attempts, 2); assert.equal(jobs[0].status, 'sent');
  await assert.rejects(t.api.retry(job.id, 7));
});
await check('后台重启恢复未投递任务；投递中的任务不重复发送', async () => {
  const base = { id: 'old-1', windowId: 7, text: 'A', autoSend: true, attempts: 1, status: 'waiting-page' };
  const t = setup({ storage: { [KEY]: [base, { ...base, id: 'old-2', status: 'delivering' }] } });
  const jobs = await finished(t); assert.equal(jobs[0].status, 'sent'); assert.equal(jobs[1].status, 'uncertain');
  assert.equal(t.calls.filter((call) => call[0] === 'deliver').length, 1);
});
await check('空文本和超长文本明确拒绝，不静默截断', async () => {
  const t = setup(); await assert.rejects(t.api.enqueue(' ', 'test', 7)); await assert.rejects(t.api.enqueue('x'.repeat(20001), 'test', 7));
});
console.log('队列测试：' + passed + ' 项通过');
