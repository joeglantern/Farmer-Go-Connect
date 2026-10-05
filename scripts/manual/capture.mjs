#!/usr/bin/env node
/**
 * Screenshots for the product manual (apps/app/public/guide). Signs in as each demo role on a
 * running stack, prepares the data a screen needs, and saves phone-sized WebP images.
 *
 *   node scripts/manual/capture.mjs [--base https://app.<host>] [--api https://api.<host>] [--only farmer-home,qa-task]
 *
 * Needs the demo seed (tester stack). One headless Chrome for the whole run.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])),
);
const BASE = (args.base ?? 'https://app.156-67-25-84.sslip.io').replace(/\/$/, '');
const API = (args.api ?? 'https://api.156-67-25-84.sslip.io').replace(/\/$/, '');
const OUT = join(process.cwd(), 'apps/app/public/guide/shots');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'farmgo-demo-2026';
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const W = 390;
const H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── API helpers ──────────────────────────────────────────────
async function call(method, path, { token, org, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      origin: BASE,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'x-org-id': org } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (res.status >= 400) throw new Error(`${method} ${path} ${res.status} ${json?.error?.code ?? ''}`);
  return json;
}
const list = (b) => (Array.isArray(b) ? b : (b?.items ?? []));
const signIn = async (email) =>
  (await call('POST', '/api/auth/sign-in/email', { body: { email, password: PASSWORD } })).token;
async function viewAs(admin, q) {
  const u = list(await call('GET', `/v1/admin/users?q=${encodeURIComponent(q)}&limit=5`, { token: admin }))[0];
  if (!u) throw new Error(`no demo user ${q}`);
  return (await call('POST', '/api/auth/admin/impersonate-user', { token: admin, body: { userId: u.id } }))
    .session.token;
}
async function householdToken(admin) {
  const home = list(await call('GET', '/v1/admin/orgs?limit=100', { token: admin })).find(
    (o) => o.profile?.buyerCategory === 'HOUSEHOLD',
  );
  const detail = await call('GET', `/v1/admin/orgs/${home.id}`, { token: admin });
  const userId = detail.members?.[0]?.user?.id ?? detail.members?.[0]?.userId;
  return (await call('POST', '/api/auth/admin/impersonate-user', { token: admin, body: { userId } })).session
    .token;
}
const orgOf = async (token) => (await call('GET', '/v1/me', { token })).organizations?.[0]?.id;

// ─── Sessions and data ────────────────────────────────────────
console.log(`Manual screenshots from ${BASE}`);
const admin = await signIn('admin@farmgo.test');
const T = {
  admin,
  buyer: await signIn('buyer@serena.test'),
  chef: await signIn('chef@javahouse.test'),
  qa: await signIn('qa@farmgo.test'),
  agent: await signIn('agent@farmgo.test'),
  driver: await signIn('driver@farmgo.test'),
  supplier: await signIn('compost@greenyouth.test'),
  farmer: await viewAs(admin, 'Mary Wambui'),
  household: await householdToken(admin),
};
const buyerOrg = await orgOf(T.buyer);
// The manual is in English, and the app applies each account's saved language on launch.
for (const t of Object.values(T)) await call('PATCH', '/v1/me', { token: t, body: { preferredLanguage: 'en' } });

const listings = list(await call('GET', '/v1/supply?limit=30', { token: T.buyer, org: buyerOrg }));
const live = listings.filter((l) => ['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) && l.quantityLeft >= 5);
const pick = (name) => live.find((l) => l.produce.name.toLowerCase().includes(name)) ?? live[0];
const cartLine = (l, quantity) => ({
  listingId: l.id,
  quantity,
  produce: {
    id: l.produce.id,
    name: l.produce.name,
    nameSw: l.produce.nameSw,
    unit: l.produce.unit,
    category: l.produce.category,
    imageUrl: l.produce.imageUrl ?? null,
  },
  farm: { id: l.farm.id, name: l.farm.name, county: l.farm.county, farmerName: l.farm.farmer.user.name },
  pricePerUnit: l.pricePerUnit,
  available: Number(l.quantityLeft),
  photoUrl: l.photoUrls?.[0] ?? l.produce.imageUrl ?? null,
  addedAt: Date.now(),
});
const cart = JSON.stringify({
  state: { lines: [cartLine(pick('spinach'), 4), cartLine(pick('kale'), 3)].filter(Boolean) },
  version: 1,
});

// One fresh order waiting for its quality check, so the QA and order screens show live states.
async function freshOrder() {
  const slots = await call('GET', '/v1/delivery/slots?days=9', { token: T.buyer, org: buyerOrg });
  const day = slots.days.find((d) => d.available);
  const win = day.windows.find((w) => w.available);
  const mine = list(await call('GET', '/v1/supply?mine=true&limit=50', { token: T.farmer })).find(
    (l) => ['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) && l.quantityLeft >= 6,
  );
  const placed = await call('POST', '/v1/checkout', {
    token: T.buyer,
    org: buyerOrg,
    body: {
      items: [{ listingId: mine.id, quantity: 6, pricePerUnit: mine.pricePerUnit }],
      deliveryDate: day.date,
      deliveryWindow: win.window,
      paymentMethod: 'MPESA',
      phoneNumber: '+254712345678',
    },
  });
  const orderId = placed.orders[0].id;
  for (let i = 0; i < 20; i++) {
    const c = await call('GET', `/v1/checkouts/${placed.checkoutId}`, { token: T.buyer, org: buyerOrg });
    if (c.payment.status === 'SUCCESS') break;
    await sleep(1500);
  }
  await call('POST', `/v1/orders/${orderId}/confirm`, { token: T.farmer, body: {} });
  await call('POST', `/v1/orders/${orderId}/ready`, { token: T.farmer, body: {} });
  return orderId;
}
const qaOrder = await freshOrder();
const delivered = list(await call('GET', '/v1/orders?scope=past&limit=10', { token: T.buyer, org: buyerOrg })).find(
  (o) => o.status === 'COMPLETED',
);
const featured = list(await call('GET', '/v1/farmers/featured?limit=3', { token: T.buyer }))[0];
const myListing = list(await call('GET', '/v1/supply?mine=true&limit=5', { token: T.farmer }))[0];
const invoice = list(await call('GET', '/v1/invoices?limit=1', { token: T.chef }))[0];

// ─── What to capture ──────────────────────────────────────────
const SHOTS = [
  ['welcome', null, '/welcome'],
  ['sign-in', null, '/sign-in'],
  ['buyer-home', 'buyer', '/home'],
  ['buyer-category', 'buyer', '/category/vegetables'],
  ['buyer-product', 'buyer', `/product/${pick('tomato').id}`],
  ['buyer-cart', 'buyer', '/cart', { cart }],
  ['buyer-checkout', 'buyer', '/checkout', { cart, wait: 7000 }],
  ['buyer-orders', 'buyer', '/orders'],
  ['buyer-order', 'buyer', `/order/${qaOrder}`],
  ['buyer-track', 'buyer', `/track/${delivered?.id ?? qaOrder}`],
  ['buyer-chat', 'buyer', `/chat/${delivered?.id ?? qaOrder}`],
  ['buyer-requirement', 'buyer', '/requirements/new'],
  ['buyer-requirements', 'buyer', '/requirements'],
  ['buyer-farmer', 'buyer', `/farmer/${featured?.id ?? featured?.farmerId}`],
  ['buyer-invoices', 'chef', invoice ? `/invoices/${invoice.id}` : '/invoices'],
  ['household-home', 'household', '/home'],
  ['farmer-home', 'farmer', '/home'],
  ['farmer-sell', 'farmer', '/sell'],
  ['farmer-listings', 'farmer', '/listings'],
  ['farmer-listing', 'farmer', `/listings/${myListing.id}`],
  ['farmer-demand', 'farmer', '/demand-board'],
  ['farmer-order', 'farmer', `/order/${qaOrder}`],
  ['farmer-earnings', 'farmer', '/earnings'],
  ['farmer-inputs', 'farmer', '/inputs'],
  ['agent-home', 'agent', '/home'],
  ['agent-register', 'agent', '/agent/register'],
  ['qa-home', 'qa', '/home'],
  ['qa-task', 'qa', `/qa/${qaOrder}`],
  ['driver-home', 'driver', '/home'],
  ['driver-scan', 'driver', '/scan'],
  ['supplier-home', 'supplier', '/home'],
  ['supplier-products', 'supplier', '/products'],
  ['supplier-orders', 'supplier', '/orders'],
  ['admin-home', 'admin', '/home'],
  ['admin-money', 'admin', '/money'],
  ['admin-logistics', 'admin', '/logistics'],
  ['profile', 'buyer', '/profile'],
  ['help', 'buyer', '/help'],
];

// ─── One Chrome ───────────────────────────────────────────────
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'farmgo-manual-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
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
    const i = ++seq;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 36, right: 0, bottom: 20, left: 0 } });

mkdirSync(OUT, { recursive: true });
let done = 0;
try {
  for (const [name, role, path, opts = {}] of SHOTS) {
    if (ONLY && !ONLY.has(name)) continue;
    await send('Page.navigate', { url: `${BASE}/favicon.ico` });
    await sleep(500);
    const store = { 'farmgo.language': 'en' };
    if (role) store['farmgo.session'] = T[role];
    if (opts.cart) store['farmgo.cart'] = opts.cart;
    await send('Runtime.evaluate', {
      expression: `localStorage.clear(); ${Object.entries(store)
        .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
        .join(' ')}`,
    });
    await send('Page.navigate', { url: BASE + path });
    await sleep(opts.wait ?? 5500);
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 86 });
    writeFileSync(join(OUT, `${name}.webp`), Buffer.from(shot.result.data, 'base64'));
    done++;
    console.log(`saved ${name}`);
  }
} finally {
  ws.close();
  chrome.kill();
}
console.log(`${done} screenshots in apps/app/public/guide/shots`);
process.exit(0);
