#!/usr/bin/env node
/**
 * One headless Chrome screenshot of the web app, with a real phone or desktop viewport.
 *
 *   node scripts/shot.mjs <url> <out.png> [width=390] [height=844] [waitMs=9000] ['{"farmgo.session":"<token>"}']
 *
 * Env:
 *   SAFE_AREA=59,0,34,0   emulate an iPhone notch and home indicator (top,right,bottom,left)
 *   SHOT_LOGS=1           also write <out.png>.log.txt with console errors and warnings
 *   CHROME=<path>         Chrome binary (defaults to the standard Windows install)
 *
 * Starts one Chrome, takes one shot, and quits it, so memory use stays small.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, w = '390', h = '844', wait = '9000', ls = ''] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [localStorageJSON]');
  process.exit(2);
}

const chromePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'farmgo-shot-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    // Chrome is still starting
  }
}
if (!target) {
  chrome.kill();
  console.error('Chrome did not start');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    logs.push(
      m.params.args
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 900),
    );
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push(`EXC ${(d.exception?.description ?? d.text).slice(0, 900)}`);
  }
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

await send('Emulation.setDeviceMetricsOverride', {
  width: +w,
  height: +h,
  deviceScaleFactor: 2,
  mobile: +w < 600,
});
if (process.env.SAFE_AREA) {
  const [top, right, bottom, left] = process.env.SAFE_AREA.split(',').map(Number);
  await send('Emulation.setSafeAreaInsetsOverride', { insets: { top, right, bottom, left } });
}
await send('Page.enable');
await send('Runtime.enable');
if (ls) {
  // Seed localStorage on the app's origin before loading the real page.
  await send('Page.navigate', { url: `${new URL(url).origin}/favicon.ico` });
  await sleep(800);
  for (const [k, v] of Object.entries(JSON.parse(ls))) {
    await send('Runtime.evaluate', {
      expression: `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`,
    });
  }
}
await send('Page.navigate', { url });
await sleep(+wait);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
if (process.env.SHOT_LOGS) writeFileSync(`${out}.log.txt`, logs.join('\n---\n'));
ws.close();
chrome.kill();
process.exit(0);
