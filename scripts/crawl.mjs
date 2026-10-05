#!/usr/bin/env node
/**
 * UI route crawler: opens every screen each role can reach, in one headless Chrome, and fails a
 * page on a console error or exception, a nested-button warning, a raw i18n key in the visible
 * text, the "page not here" screen, or sideways overflow.
 *
 *   node scripts/crawl.mjs [--base http://localhost:8081] [--api http://localhost:4000]
 *                          [--roles buyer,farmer,...] [--matrix 390x844:sw,1440x900:en]
 *                          [--wait 4500] [--out docs/qa/crawl-report.md] [--shots docs/qa/crawl-shots]
 *
 * Env: CHROME=<path> (default: standard Windows Chrome), CRAWL_PASSWORD (default farmgo-demo-2026).
 * Email roles sign in with their demo account; phone-only roles (farmers, households) are opened by
 * signing in as admin and impersonating them. Exit code 1 when any page fails.
 *
 * Copies the CDP pattern of scripts/shot.mjs, but keeps one Chrome and one tab for the whole run
 * and navigates between pages, so memory stays small.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1];
const BASE = (args.base ?? 'http://localhost:8081').replace(/\/$/, '');
const API = (args.api ?? 'http://localhost:4000').replace(/\/$/, '');
const WAIT = Number(args.wait ?? 4500);
const OUT = join(ROOT, args.out ?? 'docs/qa/crawl-report.md');
const SHOTS = join(ROOT, args.shots ?? 'docs/qa/crawl-shots');
const PASSWORD = process.env.CRAWL_PASSWORD ?? 'farmgo-demo-2026';
const MATRIX = (args.matrix ?? '390x844:sw,1440x900:en').split(',').map((m) => {
  const [size, lang = 'en'] = m.split(':');
  const [w, h] = size.split('x').map(Number);
  return { w, h, lang, name: `${w}-${lang}` };
});

// ─── Who signs in how ─────────────────────────────────────────
const ACCOUNTS = {
  signedOut: { none: true },
  buyer: { email: 'buyer@serena.test' },
  invoiceBuyer: { email: 'chef@javahouse.test' },
  household: { impersonate: 'household' },
  farmer: { impersonate: '+254711000001' },
  agent: { email: 'agent@farmgo.test' },
  qa: { email: 'qa@farmgo.test' },
  driver: { email: 'driver@farmgo.test' },
  supplier: { email: 'compost@greenyouth.test' },
  admin: { email: 'admin@farmgo.test' },
};

// ─── What each role can reach ([x] = an id fetched below) ─────
const COMMON = [
  'home',
  'orders',
  'messages',
  'notifications',
  'profile',
  'help',
  'settings/profile',
  'settings/notifications',
  'settings/security',
  'settings/delete-account',
  'nope-not-a-route',
];
const BUYER = [
  ...COMMON,
  'cart',
  'checkout',
  'search',
  'farmers',
  'favorites',
  'addresses',
  'requirements',
  'requirements/new',
  'matches',
  'invoices',
  'prices',
  'settings/business',
  'category/vegetables',
  'category/all',
  'product/[listing]',
  'farmer/[farmerProfile]',
  'order/[order]',
  'chat/[order]',
  'track/[order]',
  'report/[order]',
  'requirements/[demand]',
  'invoices/[invoice]',
];
const ROUTES = {
  signedOut: [
    'welcome',
    'role',
    'sign-in',
    'sign-up',
    'forgot',
    'reset-password',
    'verify?phone=%2B254711000001',
    'nope-not-a-route',
  ],
  buyer: BUYER,
  invoiceBuyer: [...BUYER],
  household: [...BUYER],
  farmer: [
    ...COMMON,
    'sell',
    'listings',
    'demand-board',
    'matches',
    'earnings',
    'prices',
    'farms',
    'inputs',
    'input-orders',
    'listings/[myListing]',
    'farms/[farm]',
    'inputs/[input]',
    'order/[order]',
    'chat/[order]',
  ],
  agent: [...COMMON, 'agent/register', 'agent/farmer/[agentFarmer]'],
  qa: [...COMMON, 'history', 'qa/[qaOrder]'],
  driver: [...COMMON, 'scan', 'history', 'route/[route]', 'stop/[stop]'],
  supplier: [...COMMON, 'products', 'input-orders', 'products/[myProduct]'],
  admin: [
    ...COMMON,
    'people',
    'money',
    'logistics',
    'admin/catalog',
    'admin/settings',
    'settings/view-as',
    'admin/users/[user]',
    'admin/orgs/[org]',
    'admin/routes/[adminRoute]',
    'admin/disputes/[dispute]',
  ],
};
const ONLY = args.roles ? args.roles.split(',') : Object.keys(ACCOUNTS);

// ─── API helpers ──────────────────────────────────────────────
async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      origin: BASE,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json };
}
const list = (b) => (Array.isArray(b) ? b : (b?.items ?? []));
const firstId = (b) => list(b)[0]?.id ?? null;

async function signIn(email) {
  const r = await call('POST', '/api/auth/sign-in/email', { body: { email, password: PASSWORD } });
  if (r.status !== 200 || !r.body?.token) throw new Error(`sign-in ${email}: ${r.status}`);
  return r.body.token;
}

async function impersonate(adminToken, who) {
  let userId = null;
  if (who === 'household') {
    const orgs = list((await call('GET', '/v1/admin/orgs?limit=100', { token: adminToken })).body);
    const home = orgs.find((o) => o.profile?.buyerCategory === 'HOUSEHOLD');
    if (!home) return null;
    const detail = (await call('GET', `/v1/admin/orgs/${home.id}`, { token: adminToken })).body;
    userId = detail?.members?.[0]?.user?.id ?? detail?.members?.[0]?.userId ?? null;
  } else {
    const users = list(
      (await call('GET', `/v1/admin/users?q=${encodeURIComponent(who)}`, { token: adminToken })).body,
    );
    userId = users[0]?.id ?? null;
  }
  if (!userId) return null;
  const r = await call('POST', '/api/auth/admin/impersonate-user', { token: adminToken, body: { userId } });
  return r.body?.session?.token ?? r.body?.token ?? null;
}

/** Real ids for [param] routes, fetched with the role's own token so every link is one it may open. */
async function idsFor(role, token, adminToken) {
  const get = async (path, t = token) => (await call('GET', path, { token: t })).body;
  const ids = {};
  const tryIt = async (key, fn) => {
    try {
      ids[key] = (await fn()) ?? null;
    } catch {
      ids[key] = null;
    }
  };
  const needs = new Set(ROUTES[role].flatMap((r) => [...r.matchAll(/\[(\w+)\]/g)].map((m) => m[1])));
  if (needs.has('order')) await tryIt('order', async () => firstId(await get('/v1/orders?limit=1')));
  if (needs.has('listing')) await tryIt('listing', async () => firstId(await get('/v1/supply?limit=1')));
  if (needs.has('farmerProfile'))
    await tryIt('farmerProfile', async () => {
      const f = list(await get('/v1/farmers/featured?limit=1'))[0];
      return f?.id ?? f?.farmerId ?? null;
    });
  if (needs.has('demand')) await tryIt('demand', async () => firstId(await get('/v1/demand?limit=1')));
  if (needs.has('invoice')) await tryIt('invoice', async () => firstId(await get('/v1/invoices?limit=1')));
  if (needs.has('myListing'))
    await tryIt('myListing', async () => firstId(await get('/v1/supply?mine=true&limit=1')));
  if (needs.has('farm')) await tryIt('farm', async () => firstId(await get('/v1/farms')));
  if (needs.has('input')) await tryIt('input', async () => firstId(await get('/v1/inputs?limit=1')));
  if (needs.has('agentFarmer'))
    await tryIt('agentFarmer', async () => firstId(await get('/v1/agent/farmers?limit=1')));
  if (needs.has('qaOrder')) await tryIt('qaOrder', async () => firstId(await get('/v1/qa/tasks')));
  if (needs.has('route') || needs.has('stop'))
    await tryIt('route', async () => {
      const r = list(await get('/v1/routes/today'))[0];
      ids.stop = r?.stops?.[0]?.id ?? null;
      return r?.id ?? null;
    });
  if (needs.has('myProduct'))
    await tryIt('myProduct', async () => {
      const org = await get('/v1/orgs/current');
      const items = list(await get('/v1/inputs?limit=100'));
      return (
        (items.find((p) => p.supplierOrgId === org?.id || p.supplierOrg?.id === org?.id) ?? items[0])?.id ??
        null
      );
    });
  if (needs.has('user'))
    await tryIt('user', async () => firstId(await get('/v1/admin/users?limit=1', adminToken)));
  if (needs.has('org'))
    await tryIt('org', async () => firstId(await get('/v1/admin/orgs?limit=1', adminToken)));
  if (needs.has('adminRoute'))
    await tryIt('adminRoute', async () => firstId(await get('/v1/routes?limit=1', adminToken)));
  if (needs.has('dispute'))
    await tryIt('dispute', async () => firstId(await get('/v1/admin/disputes?limit=1', adminToken)));
  return ids;
}

// ─── Copy rules from the app's own dictionaries ───────────────
const en = readFileSync(join(ROOT, 'apps/app/src/i18n/en.ts'), 'utf8');
const sw = readFileSync(join(ROOT, 'apps/app/src/i18n/sw.ts'), 'utf8');
const NAMESPACES = [...en.matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]);
const RAW_KEY = new RegExp(`\\b(?:${NAMESPACES.join('|')})\\.[A-Za-z][\\w.]*\\b`);
const missingTitle = (src) => src.match(/missingPage: \{\s*title: '([^']+)'/)?.[1];
const NOT_FOUND = [missingTitle(en), missingTitle(sw), 'Unmatched Route', 'Page could not be found'].filter(
  Boolean,
);
const NESTED = /cannot be a descendant of|cannot contain a nested|validateDOMNesting/i;
// Dev-only noise that is not a product bug.
const IGNORE =
  /Download the React DevTools|pointerEvents is deprecated|shadow\*? style props are deprecated|Listening to push token changes|out of sync\. Reload/i;

/** Every route file in the app, so the report can show anything no role visits. */
function appRoutes() {
  const dir = join(ROOT, 'apps/app/src/app');
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(f) && !f.startsWith('_') && !f.startsWith('+')) {
        const r = relative(dir, p)
          .replace(/\\/g, '/')
          .replace(/\.tsx$/, '')
          .replace(/\([^)]+\)\//g, '')
          .replace(/(^|\/)index$/, '');
        out.push(r);
      }
    }
  };
  walk(dir);
  return out.filter(Boolean);
}

// ─── One Chrome, one tab ──────────────────────────────────────
const chromePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'farmgo-crawl-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  } catch {}
}
if (!target) {
  chrome.kill();
  console.error('Chrome did not start');
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
let logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    logs.push({
      type: m.params.type,
      text: m.params.args
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 900),
    });
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push({ type: 'exception', text: (d.exception?.description ?? d.text).slice(0, 900) });
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push({ type: 'network', text: `${m.params.entry.text} ${m.params.entry.url ?? ''}`.slice(0, 400) });
  }
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
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result
    ?.value;
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

async function setStorage(entries) {
  await send('Page.navigate', { url: `${BASE}/favicon.ico` });
  await sleep(600);
  await evaluate(
    `localStorage.clear(); sessionStorage.clear(); ${Object.entries(entries)
      .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join(' ')} true`,
  );
}

const PAGE_PROBE = `(() => {
  const text = document.body ? document.body.innerText : '';
  return {
    path: location.pathname,
    text: text.slice(0, 20000),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
})()`;

// ─── Crawl ────────────────────────────────────────────────────
mkdirSync(SHOTS, { recursive: true });
const results = [];
const skipped = [];
const health = await call('GET', '/health/ready').catch(() => ({ status: 0 }));
if (health.status !== 200) {
  console.error(`API not ready at ${API} (status ${health.status}). Start pnpm dev first.`);
  chrome.kill();
  process.exit(1);
}
const adminToken = await signIn(ACCOUNTS.admin.email);

for (const role of ONLY) {
  const acc = ACCOUNTS[role];
  if (!acc) continue;
  let token = null;
  try {
    token = acc.none
      ? null
      : acc.email
        ? await signIn(acc.email)
        : await impersonate(adminToken, acc.impersonate);
  } catch (e) {
    skipped.push({ role, route: '(all)', why: e.message });
    continue;
  }
  if (!token && !acc.none) {
    skipped.push({ role, route: '(all)', why: `no ${acc.impersonate} account to open` });
    continue;
  }
  const ids = acc.none ? {} : await idsFor(role, token, adminToken);
  for (const view of MATRIX) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: view.w,
      height: view.h,
      deviceScaleFactor: 1,
      mobile: view.w < 600,
    });
    await setStorage(
      token ? { 'farmgo.session': token, 'farmgo.language': view.lang } : { 'farmgo.language': view.lang },
    );
    for (const tmpl of ROUTES[role]) {
      const missing = [...tmpl.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((k) => !ids[k]);
      if (missing.length) {
        if (view === MATRIX[0])
          skipped.push({ role, route: tmpl, why: `no ${missing.join(', ')} id for this account` });
        continue;
      }
      const route = tmpl.replace(/\[(\w+)\]/g, (_, k) => ids[k]);
      logs = [];
      await send('Page.navigate', { url: `${BASE}/${route}` });
      await sleep(WAIT);
      const p = (await evaluate(PAGE_PROBE)) ?? { path: '?', text: '', overflow: false };
      const problems = [];
      const expectNotFound = tmpl === 'nope-not-a-route';
      const relevant = logs.filter((l) => !IGNORE.test(l.text));
      const nested = relevant.filter((l) => NESTED.test(l.text));
      const errors = relevant.filter((l) => !NESTED.test(l.text) && l.type !== 'warning');
      if (nested.length) problems.push(`nested button (${nested.length}): ${nested[0].text.slice(0, 160)}`);
      for (const e of errors.slice(0, 3)) problems.push(`${e.type}: ${e.text.slice(0, 200)}`);
      const raw = p.text.match(RAW_KEY);
      if (raw) problems.push(`raw i18n key: ${raw[0]}`);
      const isNotFound = NOT_FOUND.some((t) => p.text.includes(t));
      if (isNotFound && !expectNotFound) problems.push('not-found screen');
      if (expectNotFound && !isNotFound) problems.push('unknown route did not show the not-found screen');
      if (p.overflow) problems.push(`sideways overflow (${p.scrollWidth} > ${p.innerWidth})`);
      if (!acc.none && /^\/(welcome|sign-in)/.test(p.path)) problems.push(`signed out: landed on ${p.path}`);
      const redirected =
        p.path.replace(/\/$/, '') !== `/${route.split('?')[0]}`.replace(/\/$/, '') && !expectNotFound;
      const shot = `${role}-${view.name}-${tmpl.replace(/[^\w]+/g, '_')}.png`;
      if (problems.length) {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        if (s.result?.data) writeFileSync(join(SHOTS, shot), Buffer.from(s.result.data, 'base64'));
      }
      results.push({
        role,
        view: view.name,
        route: tmpl,
        landed: redirected ? p.path : '',
        problems,
        shot: problems.length ? shot : '',
      });
      console.log(
        `${problems.length ? 'FAIL' : 'ok  '} ${role.padEnd(12)} ${view.name.padEnd(8)} ${tmpl.padEnd(32)} ${redirected ? `-> ${p.path} ` : ''}${problems.join(' | ').slice(0, 200)}`,
      );
    }
  }
}
ws.close();
chrome.kill();

// ─── Report ───────────────────────────────────────────────────
const crawled = new Set(
  Object.entries(ROUTES)
    .filter(([r]) => ONLY.includes(r))
    .flatMap(([, rs]) => rs.map((r) => r.split('?')[0].replace(/\[\w+\]/g, '[x]'))),
);
const notCovered = appRoutes().filter((r) => !crawled.has(r.replace(/\[\w+\]/g, '[x]')));
const failed = results.filter((r) => r.problems.length);
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [
  '# Route crawl report',
  '',
  `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC against ${BASE} (API ${API}). Generated by \`node scripts/crawl.mjs\`; do not edit by hand.`,
  '',
  `Pages checked: ${results.length}. Failed: ${failed.length}. Skipped: ${skipped.length}. Views: ${MATRIX.map((m) => `${m.w}x${m.h} ${m.lang.toUpperCase()}`).join(', ')}.`,
  '',
  'A page fails on a console error or exception, a nested-button warning, a raw i18n key in the visible text, the "page not here" screen (except the deliberate unknown route), sideways overflow, or being signed out.',
  '',
  '## Failures',
  '',
  failed.length ? '| role | view | route | problems | screenshot |' : 'None.',
  ...(failed.length ? ['|---|---|---|---|---|'] : []),
  ...failed.map(
    (r) =>
      `| ${r.role} | ${r.view} | ${esc(r.route)}${r.landed ? ` (landed on ${esc(r.landed)})` : ''} | ${esc(r.problems.join('; '))} | ${r.shot ? `crawl-shots/${r.shot}` : ''} |`,
  ),
  '',
  '## Skipped',
  '',
  skipped.length ? '| role | route | why |' : 'None.',
  ...(skipped.length ? ['|---|---|---|'] : []),
  ...skipped.map((s) => `| ${s.role} | ${esc(s.route)} | ${esc(s.why)} |`),
  '',
  '## Routes no role visits',
  '',
  notCovered.length ? notCovered.map((r) => `- ${r}`).join('\n') : 'None.',
  '',
  '## All pages',
  '',
  '| role | view | route | result | landed on |',
  '|---|---|---|---|---|',
  ...results.map(
    (r) =>
      `| ${r.role} | ${r.view} | ${esc(r.route)} | ${r.problems.length ? 'fail' : 'ok'} | ${esc(r.landed)} |`,
  ),
  '',
];
writeFileSync(OUT, lines.join('\n'));
console.log(
  `\n${results.length} pages, ${failed.length} failed, ${skipped.length} skipped. Report: ${relative(ROOT, OUT)}`,
);
process.exit(failed.length ? 1 : 0);
