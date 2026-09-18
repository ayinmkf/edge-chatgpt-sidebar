import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { startBrowser, until, sleep } from './chromium-harness.mjs';

// All ChatGPT responses are intercepted locally in the isolated browser. No real account or prompts are used.
function mock(url) {
  const mode = new URL(url).searchParams.get('mode') || 'normal';
  return `<!doctype html><html><head><meta charset="utf-8"><title>ChatGPT editor fixture</title></head><body>
    <main id="conversation"></main><div id="mount"></div><script>
      window.sent=[]; const mode=${JSON.stringify(mode)};
      function mount() {
        if (mode==='missing') return;
        document.getElementById('mount').innerHTML='<form>'+(mode==='textarea' ? '<textarea id="prompt-textarea"></textarea>' : '<div id="prompt-textarea" contenteditable="true" class="ProseMirror" role="textbox" style="border:1px solid #aaa;min-height:50px"></div>')+'</form>';
        const box=document.getElementById('prompt-textarea');
        const read=()=>box.tagName==='TEXTAREA'?box.value:box.innerText;
        const clear=()=>{ if(box.tagName==='TEXTAREA')box.value='';else box.textContent=''; };
        function button() {
          if(document.querySelector('button')||mode==='no-button')return;
          const b=document.createElement('button'); b.type='button'; b.id='composer-submit-button'; b.dataset.testid='send-button'; b.textContent='Send';
          b.onclick=()=>{
            if(mode==='no-submit')return;
            const text=read(); window.sent.push(text); clear();
            if(mode==='unconfirmed')return;
            const turn=document.createElement('div'); turn.dataset.messageAuthorRole='user'; turn.innerText=text; document.getElementById('conversation').append(turn);
          };box.closest('form').append(b);
        }
        box.addEventListener('input',()=>{ if(mode==='rollback')setTimeout(clear,100); if(mode==='lazy-button')setTimeout(button,1200); });
        if(mode!=='lazy-button')button();
        if(mode==='draft') { if(box.tagName==='TEXTAREA')box.value='我的旧草稿';else box.textContent='我的旧草稿'; }
      }
      if(mode==='delayed')setTimeout(mount,1200);else mount();
    </script></body></html>`;
}
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><meta charset="utf-8"><p id="selection" style="margin:80px;font-size:24px">选区完整链路：中文第一行，第二行 ABC。</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser; let passed = 0;
const screenshot = process.argv[process.argv.indexOf('--screenshot') + 1];
const hasScreenshot = process.argv.includes('--screenshot');
async function check(name, fn) { await fn(); passed++; console.log('[通过] ' + name); }
try {
  browser = await startBrowser(mock);
  console.log(browser.browserName + ' 独立配置已加载扩展 ' + browser.extensionId);
  const sw = (code) => browser.evaluate(browser.worker.sessionId, code);
  const version = await sw('chrome.runtime.getManifest().version');
  const state = () => sw('chrome.storage.session.get("deliveryQueueV1").then(d=>d.deliveryQueueV1||[])');
  await check('真实 MV3 后台启动，默认内嵌入口与规则正确', async () => {
    assert.equal(version, '0.4.1');
    await until(async () => (await sw('chrome.sidePanel.getOptions({})')).path === 'panel/panel.html');
    assert.deepEqual((await sw('chrome.declarativeNetRequest.getEnabledRulesets()')).sort(), ['headers','site']);
  });
  const embedded = await browser.page('chrome-extension://' + browser.extensionId + '/panel/panel.html');
  const embeddedUi = (code) => browser.evaluate(embedded.sessionId, code);
  await until(async () => (await embeddedUi('document.querySelector("#status-text").textContent')).includes('已连接'));
  await check('内嵌顶部设置包含常用开关和折叠高级选项，设置即时保存', async () => {
    await embeddedUi('document.querySelector("#btn-menu").click()');
    assert.equal(await embeddedUi('document.querySelector("#menu").hidden'), false);
    assert.equal(await embeddedUi('document.querySelector("#advanced-settings").open'), false);
    await embeddedUi('document.querySelector("#opt-autosend").click();document.querySelector("#opt-fab").click()');
    await until(async () => (await sw('chrome.storage.sync.get("fab")')).fab === false);
    assert.equal((await sw('chrome.storage.sync.get("autoSend")')).autoSend,false);
    const result = await embeddedUi('chrome.runtime.sendMessage({type:"send-to-panel",text:"内嵌仅填入测试"})');
    assert.equal(result.experimental,true);
    await until(async () => (await embeddedUi('document.querySelector("#status-text").textContent')).includes('已填入'));
    await embeddedUi('document.querySelector("#opt-autosend").click();document.querySelector("#opt-fab").click()');
    await until(async () => (await sw('chrome.storage.sync.get("fab")')).fab === true);
    await browser.send('Emulation.setDeviceMetricsOverride',{width:320,height:500,deviceScaleFactor:1,mobile:false},embedded.sessionId);
    assert.equal(await embeddedUi('document.querySelector("#advanced-settings").open=true;document.documentElement.scrollWidth <= innerWidth'),true);
    if (hasScreenshot) {
      const shot=await browser.send('Page.captureScreenshot',{format:'png'},embedded.sessionId);
      writeFileSync(screenshot.replace(/\.png$/i,'-embedded.png'),Buffer.from(shot.data,'base64'));
    }
  });
  await check('从高级选项切换稳定投递，规则关闭；后台初始化保持本会话选择', async () => {
    await embeddedUi('document.querySelector("#btn-stable").click()');
    await until(async () => (await sw('chrome.sidePanel.getOptions({})')).path === 'panel/stable.html');
    assert.deepEqual(await sw('chrome.declarativeNetRequest.getEnabledRulesets()'), []);
    await sw('initializeMode()');
    assert.equal((await sw('chrome.sidePanel.getOptions({})')).path,'panel/stable.html');
  });
  const source = await browser.page('http://127.0.0.1:' + server.address().port + '/');
  const content = (code) => browser.evaluate(source.sessionId, code);
  await until(() => content('!!document.documentElement.getAttribute("data-cgpt-selection-diag")'));
  await check('真实鼠标点击浮窗 → 原生侧栏打开 → 新建 ChatGPT → 自动发送', async () => {
    await content(`(() => { const r=document.createRange();r.selectNodeContents(document.querySelector('#selection'));const s=getSelection();s.removeAllRanges();s.addRange(r); document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); })()`);
    const coords = await until(async () => content(`(() => {const b=document.querySelector('#__cgpt_sidepanel_host__')?.shadowRoot?.querySelector('.fab');if(!b?.classList.contains('show'))return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`));
    await browser.send('Input.dispatchMouseEvent', { type:'mousePressed', ...coords, button:'left', clickCount:1 }, source.sessionId);
    await browser.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...coords, button:'left', clickCount:1 }, source.sessionId);
    const job = await until(async () => (await state()).find((job) => ['sent','failed','uncertain','filled'].includes(job.status)), 40000);
    assert.equal(job.status, 'sent', JSON.stringify(job));
    assert.equal(job.panelOpened, true, job.panelError);
    assert(job.targetTabId > 0);
  });
  const firstJob = (await state())[0];
  const windowId = firstJob.windowId;
  const panel = await browser.page('chrome-extension://' + browser.extensionId + '/panel/stable.html');
  const ui = (code) => browser.evaluate(panel.sessionId, code);
  const runtime = (message) => ui('chrome.runtime.sendMessage(' + JSON.stringify({ ...message, windowId }) + ')');
  await check('侧栏显示成功状态、任务记录和完整文本；禁用成功任务重试', async () => {
    await until(async () => (await ui('document.querySelector("#status").textContent')) === '已发送');
    assert.equal(await ui('document.querySelector("#prompt-preview").value'), firstJob.text);
    assert.equal(await ui('document.querySelector("#btn-retry").disabled'), true);
  });
  let lastTabId = firstJob.targetTabId;
  async function target(mode) {
    await sw(`chrome.tabs.update(${lastTabId},{url:${JSON.stringify('https://chatgpt.com/?mode=' )}+${JSON.stringify(mode)},active:true})`);
    await sleep(300);
    await until(async () => (await sw(`chrome.tabs.get(${lastTabId})`)).status === 'complete');
    await until(async () => {
      try { return await sw(`chrome.tabs.sendMessage(${lastTabId},{type:'delivery-v3-ping'},{frameId:0}).then(r=>r.version==='0.4.1')`); } catch { return false; }
    });
  }
  async function deliver(text, autoSend = true, id = crypto.randomUUID()) {
    return sw(`chrome.tabs.sendMessage(${lastTabId},${JSON.stringify({ type:'delivery-v3-prompt', requestId:id, text, autoSend })},{frameId:0})`);
  }
  await check('仅填入开关保存，现有标签页复用', async () => {
    await runtime({ type:'set-auto-send', enabled:false });
    const result = await runtime({ type:'send-to-panel', text:'仅填入任务', source:'test' });
    assert(result.ok);
    const job = await until(async () => (await state()).find((job) => job.id === result.jobId && job.status==='filled'));
    assert.equal(job.targetTabId, lastTabId);
    await runtime({ type:'set-auto-send', enabled:true });
  });
  await check('编辑器已有草稿时不覆盖、不自动发送', async () => {
    await target('draft'); const result = await deliver('新任务'); assert.equal(result.ok,false); assert.equal(result.retryable,true); assert.match(result.reason,/草稿/);
  });
  await check('多行文本完整写入并提交，同一请求重复到达只提交一次', async () => {
    await target('normal'); const id=crypto.randomUUID();
    const result=await deliver('第一行\n第二行 <>&🙂\n\n末行',true,id);
    if (!result.sent) {
      const t=[...browser.sessions.values()].find((item)=>item.type==='page' && item.url.startsWith('https://chatgpt.com'));
      console.log('多行编辑器：',await browser.evaluate(t.sessionId,'({text:document.querySelector("#prompt-textarea").innerText,html:document.querySelector("#prompt-textarea").innerHTML})'));
    }
    assert.equal(result.sent,true,JSON.stringify(result));
    const repeated=await deliver('第一行\n第二行 <>&🙂\n\n末行',true,id); assert.equal(repeated.sent,true);
    const tab=await until(()=>[...browser.sessions.values()].find((item)=>item.type==='page' && item.url.startsWith('https://chatgpt.com')));
    assert.equal((await browser.evaluate(tab.sessionId,'window.sent')).length,1);
  });
  await check('textarea 编辑器与关闭自动发送', async () => { await target('textarea'); const result=await deliver('textarea 内容',false); assert.equal(result.filled,true); assert.equal(result.sent,false); });
  await check('发送按钮延迟出现时等待并提交', async () => { await target('lazy-button'); assert.equal((await deliver('按钮延迟')).sent,true); });
  await check('编辑器回滚内容时明确失败', async () => { await target('rollback'); const result=await deliver('会回滚'); assert.equal(result.ok,false); assert.equal(result.retryable,true); });
  await check('按钮未提交时只报告已填入', async () => { await target('no-submit'); const result=await deliver('按钮无动作'); assert.equal(result.sent,false); assert.equal(result.filled,true); });
  await check('找不到发送按钮时保留内容且不模拟回车', async () => { await target('no-button'); const result=await deliver('没有发送按钮'); assert.equal(result.sent,false); assert.equal(result.filled,true); });
  await check('输入清空但没有接收证据时不误报成功', async () => { await target('unconfirmed'); const result=await deliver('不确定结果'); assert.equal(result.uncertain,true); assert.equal(result.sent,false); });
  await check('输入框缺失时明确失败与诊断', async () => { await target('missing'); const result=await deliver('无输入框'); assert.equal(result.ok,false); assert.equal(result.diag.input,null); });
  await check('SPA 编辑器晚于 load 出现，后台等待就绪后发送', async () => {
    await target('delayed'); const result=await runtime({ type:'send-to-panel',text:'等待页面就绪',source:'test' });
    const job=await until(async()=>(await state()).find((item)=>item.id===result.jobId && !['queued','opening-chatgpt','waiting-page','delivering'].includes(item.status)));
    assert.equal(job.status,'sent',JSON.stringify(job));
  });
  await check('返回内嵌按钮恢复侧栏和规则，内嵌与独立窗口发送通过', async () => {
    await ui('document.querySelector("#btn-embedded").click()');
    await until(async () => (await sw('chrome.sidePanel.getOptions({})')).path === 'panel/panel.html');
    assert.deepEqual((await sw('chrome.declarativeNetRequest.getEnabledRulesets()')).sort(),['headers','site']);
    assert.equal((await sw('chrome.sidePanel.getOptions({})')).path,'panel/panel.html');
    const embeddedPanels=()=>[...browser.sessions.values()].filter((item)=>item.type==='page' && item.url.endsWith('/panel/panel.html'));
    await until(async()=>{
      for(const item of embeddedPanels()){
        const status=await browser.evaluate(item.sessionId,'document.querySelector("#status-text")?.textContent || ""').catch(()=>"");
        if(status.includes('已连接'))return true;
      }
      return false;
    },12000);
    await runtime({ type:'send-to-panel', text:'实验侧栏消息', source:'test' });
    await until(async()=>{
      for(const item of embeddedPanels()){
        const status=await browser.evaluate(item.sessionId,'document.querySelector("#status-text")?.textContent || ""').catch(()=>"");
        if(status.startsWith('已发送'))return true;
      }
      return false;
    },12000);
    const popup=await runtime({ type:'open-compat' });
    assert(popup.ok,JSON.stringify(popup));
    const delivered=await runtime({ type:'send-to-compat',text:'贴边窗口消息',autoSend:true,requestId:crypto.randomUUID() });
    assert.equal(delivered.sent,true,JSON.stringify(delivered));
    await runtime({ type:'close-compat' });
    await runtime({ type:'set-experimental-embedded',enabled:false });
    assert.deepEqual(await sw('chrome.declarativeNetRequest.getEnabledRulesets()'),[]);
    assert.equal((await sw('chrome.sidePanel.getOptions({})')).path,'panel/stable.html');
  });
  if (hasScreenshot) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false},panel.sessionId);
    const shot=await browser.send('Page.captureScreenshot',{format:'png'},panel.sessionId);
    writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
  }
  await check('新会话初始化恢复内嵌，保留用户偏好，不自动重发文本', async () => {
    await sw('chrome.storage.sync.set({autoSend:false}).then(()=>chrome.storage.session.remove("experimentalEmbedded"))');
    await sw('initializeMode()');
    assert.equal((await sw('chrome.sidePanel.getOptions({})')).path,'panel/panel.html');
    assert.deepEqual((await sw('chrome.declarativeNetRequest.getEnabledRulesets()')).sort(),['headers','site']);
    assert.equal((await sw('chrome.storage.sync.get("autoSend")')).autoSend,false);
    assert.equal((await sw('chrome.storage.session.get("pendingPrompt")')).pendingPrompt,undefined);
  });
  await check('页面与后台没有未处理异常', async () => { assert.deepEqual(browser.errors,[]); });
  console.log(browser.browserName + ' 完整链路：' + passed + ' 项通过');
} catch (error) {
  if (browser) {
    console.log('诊断：', await browser.evaluate(browser.worker.sessionId, 'chrome.storage.session.get(null)').catch(String));
    console.log('目标：', (await browser.send('Target.getTargets')).targetInfos.map(({type,url})=>({type,url})));
    console.log('异常：', browser.errors);
  }
  throw error;
} finally { await browser?.close(); await new Promise((resolve)=>server.close(resolve)); }
