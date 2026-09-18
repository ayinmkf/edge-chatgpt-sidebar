import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';

const root = resolve(process.argv[2] || '.');
const personal = root.endsWith('-personal');
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const profile = mkdtempSync(resolve(root, 'artifacts/appearance-test-'));
const errors = [];
const isEdge = /msedge/i.test(process.env.BROWSER_PATH || '');
let browser;
if (isEdge) {
  const child = spawn(process.env.BROWSER_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-sync', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--load-extension=' + root, '--disable-extensions-except=' + root, 'about:blank'], {stdio:'ignore', windowsHide:true});
  try {
    const deadline = Date.now() + 20000;
    let port;
    while (!port && Date.now() < deadline) {
      try { port = Number(readFileSync(resolve(profile,'DevToolsActivePort'),'utf8').split('\n')[0]); } catch {}
      if (!port) await new Promise(r => setTimeout(r,100));
    }
    if (!port) throw Error('Edge debugging port unavailable');
    browser = await puppeteer.connect({browserURL:'http://127.0.0.1:' + port});
  } catch (error) { child.kill(); throw error; }
} else {
  browser = await puppeteer.launch({
    headless:true, pipe:true, enableExtensions:[root], userDataDir:profile,
    executablePath:process.env.BROWSER_PATH || await puppeteer.executablePath(),
    args:['--no-first-run','--disable-sync']
  });
}
const server = createServer((req, res) => { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<p id="text" style="margin:100px">Appearance selection test text</p>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
try {
  const target = await browser.waitForTarget(t => t.type()==='service_worker' && t.url().endsWith('/background/service-worker.js'));
  const worker = await target.worker();
  const id = await worker.evaluate(() => chrome.runtime.id);
  console.log('Loaded worker', id);
  const panel = await browser.newPage();
  const panelWait = panel.waitForFunction.bind(panel);
  panel.waitForFunction = (fn, options = {}, ...args) => panelWait(fn, {polling:100, ...options}, ...args);
  panel.on('pageerror', e => errors.push(e.message));
  await panel.setRequestInterception(true);
  panel.on('request', req => req.url().startsWith('https://') ? req.respond({status:200,contentType:'text/html',body:'<p>Offline fixture</p>'}) : req.continue());
  await panel.goto('chrome-extension://' + id + '/panel/panel.html');
  await panel.click('#btn-menu');
  await panel.click('.appearance-settings summary');
  const defaultLabel = personal ? '问阿尔图罗' : '问 ChatGPT';
  await panel.waitForFunction(label => document.querySelector('[name="label"]').value === label, {}, defaultLabel);
  console.log('Defaults loaded');
  const source = await browser.newPage();
  const sourceWait = source.waitForFunction.bind(source);
  source.waitForFunction = (fn, options = {}, ...args) => sourceWait(fn, {polling:100, ...options}, ...args);
  source.on('pageerror', e => errors.push(e.message));
  await source.goto('http://127.0.0.1:' + server.address().port);
  await source.evaluate(() => { const range=document.createRange(); range.selectNodeContents(document.querySelector('#text')); getSelection().addRange(range); document.dispatchEvent(new MouseEvent('mouseup')); });
  await source.waitForFunction(() => document.querySelector('#__cgpt_sidepanel_host__')?.shadowRoot.querySelector('.fab.show'));
  const popup = () => source.evaluate(() => {
    const b=document.querySelector('#__cgpt_sidepanel_host__').shadowRoot.querySelector('.fab');
    return {label:b.querySelector('span').textContent, background:getComputedStyle(b).backgroundColor, icon:b.querySelector('img').src};
  });
  assert.equal((await popup()).label, defaultLabel);
  assert.equal((await popup()).background, personal ? 'rgb(0, 0, 0)' : 'rgb(16, 163, 127)');
  await source.screenshot({path:resolve(root,'artifacts/appearance-popup.png')});
  await panel.evaluate(() => {
    for(const [name,value] of [['label','<b>我的助手</b>'],['background','#112233'],['foreground','#eeeeee']]) {
      const input=document.querySelector('[name="'+name+'"]'); input.value=value; input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  });
  await panel.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('已保存'));
  await source.waitForFunction(() => document.querySelector('#__cgpt_sidepanel_host__').shadowRoot.querySelector('span').textContent === '<b>我的助手</b>');
  assert.equal((await popup()).background, 'rgb(17, 34, 51)');
  console.log('Live colors and label passed; uploading image');
  await (await panel.$('[name="icon"]')).uploadFile(resolve(root,'icons/128.png'));
  await panel.waitForFunction(() => document.querySelector('.brand-mark').src.startsWith('data:image/png'), {timeout:5000}).catch(async error => {
    console.log(await panel.evaluate(() => ({status:document.querySelector('.appearance-settings [role="status"]').textContent, icon:document.querySelector('.brand-mark').src.slice(0,30)})));
    console.log(errors);
    throw error;
  });
  await source.waitForFunction(() => document.querySelector('#__cgpt_sidepanel_host__').shadowRoot.querySelector('img').src.startsWith('data:image/png'));
  await panel.reload();
  console.log('Upload and reload passed');
  await panel.waitForFunction(() => document.querySelector('[name="label"]').value === '<b>我的助手</b>');
  await panel.bringToFront();
  await panel.click('#btn-menu');
  await panel.click('.appearance-settings summary');
  await panel.screenshot({path:resolve(root,'artifacts/appearance-settings.png')});
  console.log('Persistence passed');
  await panel.evaluate(() => chrome.runtime.sendMessage({type:'set-experimental-embedded',enabled:false}));
  console.log('Switched mode');
  await panel.goto('chrome-extension://' + id + '/panel/stable.html');
  console.log('Stable page loaded', panel.url());
  await panel.waitForSelector('.appearance-settings');
  await panel.bringToFront();
  await panel.click('.appearance-settings summary');
  await panel.click('.appearance-settings button');
  console.log('Reset clicked');
  await source.waitForFunction(label => document.querySelector('#__cgpt_sidepanel_host__').shadowRoot.querySelector('span').textContent === label, {}, defaultLabel);
  assert.equal((await popup()).background, personal ? 'rgb(0, 0, 0)' : 'rgb(16, 163, 127)');
  const data = await worker.evaluate(async () => ({local:await chrome.storage.local.get('localAppearance'),sync:await chrome.storage.sync.get('localAppearance'),manifest:chrome.runtime.getManifest()}));
  assert.equal(data.sync.localAppearance, undefined);
  assert.equal(data.manifest.version,'0.4.1');
  assert.equal(data.manifest.icons['128'],'icons/management.png');
  assert.equal(readFileSync(resolve(root,'icons/management.png')).subarray(1,4).toString(),'PNG');
  assert.deepEqual(errors, []);
  console.log('PASS appearance: defaults, live popup, literal label, upload, reload persistence, stable-mode reset, local-only storage, manifest icon: ' + root);
} catch (error) { console.error(error); throw error; }
finally { await browser.close(); server.close(); }
