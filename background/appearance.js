importScripts('../content/appearance-defaults.js');
{
  const { defaults, normalize, key } = SidebarAppearance;
  let update = Promise.resolve();
  function refresh(value) {
    update = update.catch(() => {}).then(async () => {
      const appearance = normalize(value);
      if (!appearance.icon) {
        await chrome.action.setIcon({ path: {16: 'icons/16.png',32: 'icons/32.png',48: 'icons/48.png',128: 'icons/128.png'} });
        return;
      }
      const blob = await (await fetch(appearance.icon)).blob();
      const bitmap = await createImageBitmap(blob);
      try {
        const imageData = {};
        for (const size of [16, 32, 48, 128]) {
          const canvas = new OffscreenCanvas(size, size);
          const context = canvas.getContext('2d');
          context.drawImage(bitmap, 0, 0, size, size);
          imageData[size] = context.getImageData(0, 0, size, size);
        }
        await chrome.action.setIcon({ imageData });
      } finally { bitmap.close(); }
    });
    update.catch(error => console.warn('Appearance icon update failed', error));
  }
  chrome.storage.local.get(key).then(data => refresh(data[key])).catch(console.warn);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) refresh(changes[key].newValue);
  });
}
