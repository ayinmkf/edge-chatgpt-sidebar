(() => {
  const defaults = Object.freeze({"label":"问 ChatGPT","background":"#10a37f","foreground":"#ffffff","iconPath":"icons/32.png"});
  function normalize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;
    return {
      label: typeof value.label === 'string' && value.label.trim() ? value.label.trim().slice(0, 30) : defaults.label,
      background: color(value.background, defaults.background),
      foreground: color(value.foreground, defaults.foreground),
      icon: typeof value.icon === 'string' && value.icon.length < 200000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.icon) ? value.icon : ''
    };
  }
  globalThis.SidebarAppearance = { defaults, normalize, key: 'localAppearance' };
})();
