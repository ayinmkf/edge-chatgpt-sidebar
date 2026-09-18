(() => {
  const { defaults, normalize, key } = SidebarAppearance;
  let current = normalize();
  let revision = 0;
  const container = document.getElementById('menu') || document.querySelector('main');
  const section = document.createElement('details');
  section.className = 'appearance-settings';
  section.innerHTML = `<summary>外观设置</summary>
    <label>浮窗文字 <input name="label" maxlength="30" type="text"></label>
    <label>背景颜色 <input name="background" type="color"></label>
    <label>文字颜色 <input name="foreground" type="color"></label>
    <label>个人图标 <input name="icon" type="file" accept="image/png,image/jpeg,image/webp"></label>
    <p>图片与设置仅保存在当前浏览器本地。同步应用于浮窗、侧栏和工具栏；管理页图标固定。</p>
    <button type="button">恢复默认外观</button><p role="status"></p>`;
  container.append(section);
  const status = section.querySelector('[role="status"]');
  const fields = Object.fromEntries(['label', 'background', 'foreground', 'icon'].map(n => [n, section.querySelector('[name="' + n + '"]')]));
  function render(value) {
    current = normalize(value);
    for (const name of ['label', 'background', 'foreground']) fields[name].value = current[name];
    const mark = document.querySelector('.brand-mark');
    if (mark) mark.src = current.icon || chrome.runtime.getURL(defaults.iconPath);
  }
  async function save(value) {
    const draft = normalize(value);
    render(draft);
    try {
      await chrome.storage.local.set({ [key]: draft });
      status.textContent = '已保存，外观已更新。';
    } catch { status.textContent = '保存失败，请重试。'; }
  }
  for (const name of ['label', 'background', 'foreground']) {
    fields[name].addEventListener('change', () => save({ ...current, [name]: fields[name].value }));
  }
  fields.icon.addEventListener('change', async () => {
    const request = ++revision;
    const file = fields.icon.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      status.textContent = '请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片。'; return;
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const size = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width-size)/2, (bitmap.height-size)/2, size, size, 0, 0, 128, 128);
      if (request === revision) await save({ ...current, icon: canvas.toDataURL('image/png') });
    } catch { status.textContent = '图片无法读取，请换一张图片。'; }
    finally { bitmap?.close(); fields.icon.value = ''; }
  });
  section.querySelector('button').addEventListener('click', () => { revision++; save({}); });
  chrome.storage.local.get(key).then(data => render(data[key])).catch(() => { status.textContent = '读取设置失败，请重新打开侧栏。'; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) render(changes[key].newValue);
  });
})();
