import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  enableExtensions: [root],
  args: ['--no-first-run', '--no-default-browser-check', '--disable-sync']
});

try {
  const target = await browser.waitForTarget(
    (item) => item.type() === 'service_worker' && item.url().endsWith('/background/service-worker.js'),
    { timeout: 20000 }
  );
  const worker = await target.worker();
  assert(worker, 'Chrome did not expose the extension service worker');
  const state = await worker.evaluate(async () => ({
    id: chrome.runtime.id,
    version: chrome.runtime.getManifest().version,
    hasSidePanel: !!chrome.sidePanel,
    panel: await chrome.sidePanel.getOptions({}),
    rulesets: await chrome.declarativeNetRequest.getEnabledRulesets()
  }));
  assert.equal(state.version, '0.4.1');
  assert.equal(state.hasSidePanel, true);
  assert.equal(state.panel.path, 'panel/panel.html');
  assert.deepEqual(state.rulesets.sort(), ['headers', 'site']);
  console.log(`Chrome for Testing 已加载 v${state.version}，扩展 ID ${state.id}`);
  console.log('[通过] Manifest V3、Side Panel、后台 worker 与默认内嵌规则');
} finally {
  await browser.close();
}
