/* Stable sidebar: one window's durable queue and explicit delivery outcomes. */
const $ = (id) => document.getElementById(id);
let windowId;
let jobs = [];
let selectedId = null;
let refreshVersion = 0;
const labels = {
  queued: '已排队', 'opening-chatgpt': '正在打开 ChatGPT', 'waiting-page': '等待 ChatGPT 就绪',
  delivering: '正在写入', sent: '已发送', filled: '已填入，请检查', failed: '投递失败', uncertain: '发送状态未确认'
};
const active = new Set(['queued', 'opening-chatgpt', 'waiting-page', 'delivering']);
function current() { return jobs.find((job) => job.id === selectedId) || jobs.at(-1) || null; }
async function send(message) {
  const result = await chrome.runtime.sendMessage({ ...message, windowId });
  if (!result?.ok) throw new Error(result?.error || '扩展没有回应，请重新打开侧栏');
  return result;
}
function feedback(error) { $('status-detail').textContent = String(error?.message || error); }
function render() {
  const job = current();
  $('job-list').replaceChildren(...jobs.slice().reverse().map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = new Date(item.createdAt).toLocaleTimeString() + ' · ' + (labels[item.status] || item.status) + ' · ' + item.text.slice(0, 24).replace(/\s+/g, ' ');
    option.selected = job?.id === item.id;
    return option;
  }));
  $('status').textContent = job ? labels[job.status] : '等待选中文本';
  const description = job?.error || ({
    queued: '内容已保存；前面的任务完成后会自动投递。',
    'opening-chatgpt': '正在寻找本窗口最近使用的 ChatGPT 标签页。',
    'waiting-page': '请在目标标签页完成登录或验证。准备好后会自动写入。',
    delivering: '正在写入并等待 ChatGPT 确认。',
    sent: '已在 ChatGPT 页面观察到消息被接收。',
    filled: job?.autoSend ? '文字已填入，请到 ChatGPT 页面检查并手动发送。' : '文字已填入，等待你手动发送。'
  }[job?.status]) || '在网页选中文字后点击“问 ChatGPT”，或使用右键菜单。';
  $('status-detail').textContent = description + (job?.panelError ? ' 侧栏未能自动打开时，请点击工具栏中的扩展图标。' : '');
  $('status-dot').className = 'dot ' + (active.has(job?.status) ? 'working' : job?.status === 'sent' ? 'sent' : job?.status === 'failed' ? 'failed' : 'warn');
  if ($('prompt-preview').value !== (job?.text || '')) $('prompt-preview').value = job?.text || '';
  $('meta').textContent = job ? job.text.length + ' 字符 · 尝试 ' + job.attempts + ' 次 · 排队 ' + jobs.filter((item) => item.status === 'queued').length + ' 条' : '';
  $('btn-retry').disabled = !job || job.status !== 'failed' || !job.retryable;
  $('btn-copy').disabled = !job;
  $('diagnostic').textContent = job ? JSON.stringify({
    id: job.id, status: job.status, attempts: job.attempts, targetTabId: job.targetTabId,
    panelOpened: job.panelOpened, panelError: job.panelError, bridgeVersion: job.bridgeVersion,
    strategy: job.strategy, reason: job.error, diagnostic: job.diagnostic
  }, null, 2) : '暂无任务';
}
async function refresh() {
  if (windowId == null) return;
  const revision = ++refreshVersion;
  const data = await send({ type: 'get-delivery-state' });
  if (revision !== refreshVersion) return;
  const previousLatest = jobs.at(-1)?.id;
  jobs = data.jobs || [];
  if (!selectedId || selectedId === previousLatest) selectedId = jobs.at(-1)?.id || null;
  $('auto-send').checked = data.autoSend !== false;
  $('show-fab').checked = data.fab !== false;
  $('experimental-mode').checked = !!data.experimentalEmbedded;
  $('version').textContent = 'v' + data.version + ' · 任务记录仅保留到浏览器会话结束';
  render();
}
$('job-list').addEventListener('change', () => { selectedId = $('job-list').value; render(); });
$('btn-retry').addEventListener('click', () => {
  $('btn-retry').disabled = true;
  send({ type: 'retry-delivery', id: current()?.id }).then(refresh).catch(feedback);
});
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(current()?.text || ''); feedback('已复制文本。'); }
  catch { feedback('复制失败，请在上方文本框按 Ctrl+A、Ctrl+C 复制。'); }
});
$('btn-open').addEventListener('click', () => send({ type: 'open-delivery-target', id: current()?.id }).catch(feedback));
$('auto-send').addEventListener('change', () => send({ type: 'set-auto-send', enabled: $('auto-send').checked }).catch((error) => { refresh().then(() => feedback(error)); }));
$('show-fab').addEventListener('change', async () => {
  try { await chrome.storage.sync.set({ fab: $('show-fab').checked }); }
  catch (error) { feedback(error); }
});
$('experimental-mode').addEventListener('change', async () => {
  try {
    await send({ type: 'set-experimental-embedded', enabled: $('experimental-mode').checked });
    location.replace('panel.html');
  } catch (error) { $('experimental-mode').checked = false; feedback(error); }
});
$('btn-compat').addEventListener('click', async () => {
  try { await send({ type: 'open-compat', experimental: true }); location.replace('panel.html'); }
  catch (error) { feedback(error); }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && changes.deliveryQueueV1) || area === 'sync') refresh().catch(feedback);
});
(async () => {
  try { windowId = (await chrome.windows.getCurrent()).id; await refresh(); }
  catch (error) { feedback(error); }
})();
