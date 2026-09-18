# Project context

## Purpose and architecture
Unofficial desktop Edge / Chrome Manifest V3 extension for sending selected webpage text to ChatGPT. One runtime source tree; no build step or API key required. Version 0.4.1.

- background/: service worker, queued delivery, toolbar appearance.
- content/: selection popup, ChatGPT editor bridge, appearance defaults/validation.
- panel/: embedded and stable-delivery sidebars; shared appearance UI.
- icons/: shipped artwork and separate fixed management icon.
- tools/: development tests and PowerShell packaging; Puppeteer is dev-only.
- docs/: GitHub Pages, screenshots and release notes.

## Current behavior and decisions
Embedded sidebar is the default. Stable delivery and independent window are alternatives. Appearance is stored exclusively in storage.local under localAppearance. Only sanitized PNG data URLs are accepted; uploads are decoded and center-cropped to 128 × 128. Text uses textContent. Fixed management icon is separate from action icons. Restore defaults uses content/appearance-defaults.js. No user uploads belong in source control or archives.

## Verification and maintenance
Run npm run test:logic (queue plus Edge delivery), node tools/verify-appearance.mjs (Chrome for Testing); BROWSER_PATH can select a browser. Isolated profiles and test artifacts stay under artifacts/. Tests intercept ChatGPT or use fixtures, not real accounts. Run tools/package.ps1 to produce a ZIP and SHA-256 in ignored dist/. README files describe manual live-site checks.

## Known limits and next steps
ChatGPT DOM and embedding policy can change. Browser tests cannot guarantee real-site login or Cloudflare acceptance. Firefox/Safari are unsupported. User settings survive reloads but not extension removal. Release v0.4.1 adds appearance settings; maintain bilingual README, changelog and this file when behavior changes.
