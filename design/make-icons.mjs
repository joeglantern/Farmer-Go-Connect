#!/usr/bin/env node
/**
 * App icon, adaptive icon layers, splash mark, favicon and Android notification icon, all
 * rendered from the FarmGo leaf mark (the same paths as LeafMark in
 * apps/app/src/ui/brand/Logo.tsx) with headless Chrome, so every size is pixel exact.
 *
 *   node design/make-icons.mjs
 *
 * Writes into apps/app/assets/images/. Re-run after any change to the mark or colours.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'apps/app/assets/images');
const GREEN_700 = '#1C6536';
const GREEN_600 = '#257A42';
const GREEN_800 = '#155230';
const LIME = '#B9CF4B';
const LIME_DARK = '#A5C23F';
const ICON_BG = '#EEF5E9'; // pale leaf green: the leaves read clearly at 29 pt

const leaf = (mono) => {
  const c = mono
    ? { a: mono, b: mono, c: mono, d: mono, stem: mono, o: 1 }
    : { a: GREEN_700, b: GREEN_600, c: LIME, d: LIME_DARK, stem: GREEN_800, o: 1 };
  return `
    <path d="M47 86 C 20 80 5 52 10 18 C 40 22 58 50 47 86 Z" fill="${c.a}"/>
    <path d="M47 86 C 40 60 27 38 10 18 C 40 22 58 50 47 86 Z" fill="${c.b}"/>
    <path d="M51 88 C 50 52 66 22 94 10 C 100 44 84 76 51 88 Z" fill="${c.c}"/>
    <path d="M51 88 C 62 60 76 34 94 10 C 100 44 84 76 51 88 Z" fill="${c.d}"/>
    <path d="M49 96 C 48 90 47 84 44 76" stroke="${c.stem}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
};

/** A square canvas with the mark centred at `scale` of the side, on `bg` (or transparent). */
const page = (size, scale, bg, mono) => {
  const mark = Math.round(size * scale);
  const offset = Math.round((size - mark) / 2);
  return `<!doctype html><html><body style="margin:0;background:${bg ?? 'transparent'}">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
      <g transform="translate(${offset} ${offset}) scale(${mark / 100})">${leaf(mono)}</g>
    </svg></body></html>`;
};

const ASSETS = [
  // iOS and the legacy Android icon: opaque, full bleed (the OS rounds the corners).
  { file: 'icon.png', size: 1024, scale: 0.6, bg: ICON_BG },
  // Android adaptive icon: the system masks the centre 66 percent, so the mark stays inside it.
  { file: 'android-icon-foreground.png', size: 1024, scale: 0.46 },
  { file: 'android-icon-background.png', size: 1024, scale: 0, bg: ICON_BG },
  { file: 'android-icon-monochrome.png', size: 1024, scale: 0.46, mono: '#FFFFFF' },
  // Splash mark: transparent, the splash plugin supplies the background colour.
  { file: 'splash-icon.png', size: 1024, scale: 0.9 },
  // Web tab icon.
  { file: 'favicon.png', size: 196, scale: 0.78, bg: ICON_BG },
  // Android status bar: white silhouette only.
  { file: 'notification-icon.png', size: 96, scale: 0.84, mono: '#FFFFFF' },
];

const chrome = spawn(
  process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-port=9411',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'farmgo-icons-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch('http://127.0.0.1:9411/json')).json()).find((t) => t.type === 'page');
  } catch {
    // starting
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await send('Page.enable');
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
for (const a of ASSETS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: a.size,
    height: a.size,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', {
    url: `data:text/html;base64,${Buffer.from(page(a.size, a.scale, a.bg, a.mono)).toString('base64')}`,
  });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: a.size, height: a.size, scale: 1 },
  });
  writeFileSync(join(OUT, a.file), Buffer.from(shot.result.data, 'base64'));
  console.log(`wrote ${a.file} (${a.size}px)`);
}
ws.close();
chrome.kill();
process.exit(0);
