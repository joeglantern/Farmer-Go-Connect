#!/usr/bin/env node
/**
 * End-to-end API smoke test. Walks real orders through the marketplace with the demo
 * accounts: a happy path from checkout to farmer payout, the money edge cases (failed M-Pesa
 * and retry, cancel with refund, partial QA acceptance, a dispute refund), every role's home,
 * and the security boundaries.
 *
 *   pnpm smoke                                  # against http://localhost:4000
 *   API_URL=https://api.<host> pnpm smoke       # against a deployed stack
 *
 * Needs the demo seed (pnpm db:seed), the worker running, and M-Pesa in mock mode (phones
 * ending 999 fail, 000 cancel). It never deletes or anonymizes a demo account: the account
 * deletion check uses a throwaway sign-up. Exits 1 if any step fails.
 */
const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'farmgo-demo-2026';
const GOOD_PHONE = process.env.SMOKE_MPESA_PHONE ?? '+254712345678';
const FAILING_PHONE = '+254712345999';

const results = [];
let failed = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function call(method, path, { token, org, body, expect } = {}) {
  const headers = { Accept: 'application/json', 'expo-origin': 'farmgo://' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers['X-Org-Id'] = org;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const expected = Array.isArray(expect) ? expect : expect === undefined ? null : [expect];
  if (expected && !expected.includes(res.status)) {
    const code = json?.error?.code ?? '';
    throw new Error(
      `${method} ${path} returned ${res.status}${code ? ` ${code}` : ''}, expected ${expected.join(' or ')}`,
    );
  }
  return { status: res.status, json };
}

/** Run one step; a failure is recorded and returns undefined so independent steps still run. */
async function step(name, fn) {
  try {
    const out = await fn();
    // Session tokens are strings too; never print them.
    const detail = typeof out === 'string' && !name.includes('signs in') && !name.includes('opens the app') ? out : '';
    record(name, true, detail);
    return out ?? true;
  } catch (err) {
    record(name, false, err.message);
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, { tries = 20, every = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function signIn(email, password = DEMO_PASSWORD) {
  const r = await call('POST', '/api/auth/sign-in/email', { body: { email, password }, expect: 200 });
  if (!r.json?.token) throw new Error(`no token for ${email}`);
  return r.json.token;
}

async function impersonate(adminToken, userId) {
  const r = await call('POST', '/api/auth/admin/impersonate-user', {
    token: adminToken,
    body: { userId },
    expect: 200,
  });
  return r.json.session.token;
}

async function firstOrg(token) {
  const me = await call('GET', '/v1/me', { token, expect: 200 });
  return me.json.organizations?.[0]?.id ?? null;
}

async function userId(adminToken, role, name) {
  const r = await call('GET', `/v1/admin/users?role=${role}&q=${encodeURIComponent(name)}&limit=10`, {
    token: adminToken,
    expect: 200,
  });
  const u = r.json.items.find((x) => x.name === name);
  if (!u) throw new Error(`demo user ${name} (${role}) not found; run pnpm db:seed`);
  return u.id;
}

// ─── Sign in ────────────────────────────────────────────────────────────────

console.log(`FarmGo smoke test against ${API}\n`);

await step('API is ready', async () => {
  const r = await call('GET', '/health/ready', { expect: 200 });
  return Object.entries(r.json.checks ?? {})
    .map(([k, v]) => `${k} ${v.ok ? 'ok' : 'down'}`)
    .join(', ');
});

const admin = await step('admin signs in', () => signIn('admin@farmgo.test'));
const buyer = await step('buyer signs in', () => signIn('buyer@serena.test'));
const qa = await step('QA officer signs in', () => signIn('qa@farmgo.test'));
const farmer =
  admin &&
  (await step('admin opens the app as farmer Mary Wambui', async () =>
    impersonate(admin, await userId(admin, 'farmer', 'Mary Wambui')),
  ));
const buyerOrg =
  buyer &&
  (await step('buyer has a business', async () => {
    const id = await firstOrg(buyer);
    if (!id) throw new Error('no organization');
    return id;
  }));
const as = (token) => ({ token, org: token === buyer ? buyerOrg : undefined });

// ─── Browse ─────────────────────────────────────────────────────────────────

if (buyer) {
  await step('categories load without signing in', async () => {
    const r = await call('GET', '/v1/categories', { expect: 200 });
    return `${r.json.length} tiles`;
  });
  await step('search finds tomatoes in Kiswahili ("nyanya")', async () => {
    const r = await call('GET', '/v1/supply?q=nyanya&limit=5', { ...as(buyer), expect: 200 });
    if (!r.json.items.length) throw new Error('no results');
    return `${r.json.items.length} results`;
  });
  await step('buyer dashboard loads', async () => {
    await call('GET', '/v1/dashboard/buyer', { ...as(buyer), expect: 200 });
  });
  await step('featured farmers load', async () => {
    const r = await call('GET', '/v1/farmers/featured?limit=5', { token: buyer, expect: 200 });
    return `${r.json.length} farmers`;
  });
  await step('a business buyer cannot also become a household', async () => {
    const r = await call('POST', '/v1/onboarding/household', {
      ...as(buyer),
      body: { name: 'Smoke Test', county: 'Nairobi' },
      expect: 409,
    });
    return r.json?.error?.code ?? '';
  });
}

// ─── Order helpers ──────────────────────────────────────────────────────────

let listing;
let slot;
if (farmer && buyer) {
  listing = await step("pick one of Mary's live listings with stock", async () => {
    const r = await call('GET', '/v1/supply?mine=true&limit=50', { token: farmer, expect: 200 });
    const live = r.json.items.find(
      (l) =>
        ['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) &&
        Number(l.quantityLeft) >= 8 &&
        new Date(l.availableTo) > new Date(),
    );
    if (!live) throw new Error('no open listing with 8 or more left; reseed or relist');
    return live;
  });
}
if (listing) {
  slot = await step('a delivery slot is open', async () => {
    const r = await call('GET', '/v1/delivery/slots?days=9', { ...as(buyer), expect: 200 });
    const day = r.json.days.find((d) => d.available);
    const win = day?.windows.find((w) => w.available);
    if (!day || !win) throw new Error('no open slot');
    return { date: day.date, window: win.window };
  });
}

/** Checkout one listing; returns { orderId, checkoutId, payment }. */
async function placeOrder(quantity, phone) {
  const items = [{ listingId: listing.id, quantity, pricePerUnit: listing.pricePerUnit }];
  const r = await call('POST', '/v1/checkout', {
    ...as(buyer),
    body: {
      items,
      deliveryDate: slot.date,
      deliveryWindow: slot.window,
      paymentMethod: 'MPESA',
      phoneNumber: phone,
    },
    expect: 201,
  });
  return { orderId: r.json.orders[0]?.id, checkoutId: r.json.checkoutId, payment: r.json.payment };
}

async function checkout(checkoutId) {
  return (await call('GET', `/v1/checkouts/${checkoutId}`, { ...as(buyer), expect: 200 })).json;
}

async function waitPaid(checkoutId) {
  const ok = await poll(async () => (await checkout(checkoutId)).payment.status === 'SUCCESS');
  if (!ok) throw new Error('payment never reached SUCCESS');
}

async function order(orderId, token = buyer) {
  return (await call('GET', `/v1/orders/${orderId}`, { ...as(token), expect: 200 })).json;
}

async function farmerPrepares(orderId) {
  await call('POST', `/v1/orders/${orderId}/confirm`, { token: farmer, body: {}, expect: 200 });
  await call('POST', `/v1/orders/${orderId}/ready`, { token: farmer, body: {}, expect: 200 });
}

async function inspect(orderId, acceptShare) {
  const o = await order(orderId, qa);
  for (const it of o.items) {
    const qty = Number(it.quantity);
    const accepted = Math.round(qty * acceptShare * 100) / 100;
    await call('POST', '/v1/qa/inspections', {
      token: qa,
      body: {
        orderItemId: it.id,
        grade: 'A',
        passed: accepted > 0,
        acceptedQty: accepted,
        rejectedQty: Math.round((qty - accepted) * 100) / 100,
        rejectReason: accepted < qty ? 'Smoke test: part of the crate was bruised' : undefined,
        photos: [],
      },
      expect: 201,
    });
  }
  return order(orderId, qa);
}

async function deliver(orderId) {
  for (const to of ['IN_TRANSIT', 'DELIVERED']) {
    await call('POST', `/v1/orders/${orderId}/transition`, {
      token: admin,
      body: { to, note: 'smoke test' },
      expect: 200,
    });
  }
}

// ─── 1. Happy path: checkout to farmer payout ───────────────────────────────

let main;
if (slot) {
  await step('checkout quote prices the cart', async () => {
    const r = await call('POST', '/v1/checkout/quote', {
      ...as(buyer),
      body: {
        items: [{ listingId: listing.id, quantity: 1, pricePerUnit: listing.pricePerUnit }],
        deliveryDate: slot.date,
        deliveryWindow: slot.window,
      },
      expect: 200,
    });
    if (r.json.total <= 0) throw new Error('zero total');
    return `total ${r.json.total} cents`;
  });
  main = await step('buyer places an order and pays by M-Pesa', () => placeOrder(1, GOOD_PHONE));
}
if (main) {
  await step('payment is confirmed', () => waitPaid(main.checkoutId));
  await step('farmer confirms and marks it ready', () => farmerPrepares(main.orderId));
  await step('QA officer sees it in the all-counties task list', async () => {
    const r = await call('GET', '/v1/qa/tasks?county=all', { token: qa, expect: 200 });
    const list = Array.isArray(r.json) ? r.json : r.json.items;
    if (!list.some((t) => t.id === main.orderId)) throw new Error('order not in QA tasks');
  });
  await step('QA officer passes every item', async () => {
    const o = await inspect(main.orderId, 1);
    if (o.status !== 'QA_PASSED') throw new Error(`status ${o.status}`);
  });
  await step('order goes out and is delivered', () => deliver(main.orderId));
  await step('buyer can track the order', async () => {
    await call('GET', `/v1/orders/${main.orderId}/tracking`, { ...as(buyer), expect: 200 });
  });
  await step('buyer messages the farmer', async () => {
    await call('POST', `/v1/orders/${main.orderId}/messages`, {
      ...as(buyer),
      body: { body: 'Smoke test: thank you!', photos: [] },
      expect: 201,
    });
  });
  await step('farmer sees the thread in Messages', async () => {
    const r = await call('GET', '/v1/conversations', { token: farmer, expect: 200 });
    if (!r.json.some((c) => c.orderId === main.orderId)) throw new Error('thread missing');
  });
  await step('buyer confirms receipt', async () => {
    await call('POST', `/v1/orders/${main.orderId}/confirm-receipt`, { ...as(buyer), body: {}, expect: 200 });
  });
  await step('farmer is paid out by the worker', async () => {
    const paid = await poll(async () => {
      const r = await call('GET', '/v1/payouts?limit=30', { token: farmer, expect: 200 });
      return r.json.items.find((p) => p.orderId === main.orderId && p.status === 'SUCCESS');
    });
    if (!paid) throw new Error('no successful payout within 30 s; is the worker running?');
    return `${paid.amount} cents`;
  });
  await step('buyer rates the order', async () => {
    await call('POST', `/v1/orders/${main.orderId}/review`, {
      ...as(buyer),
      body: { rating: 5 },
      expect: 201,
    });
  });
  await step('notifications carry a deep link', async () => {
    const r = await call('GET', '/v1/notifications?limit=30', { ...as(buyer), expect: 200 });
    if (!r.json.items.some((n) => n.link?.route)) throw new Error('no notification with a link');
  });
  await step('buyer can order again', async () => {
    const r = await call('POST', `/v1/orders/${main.orderId}/reorder`, {
      ...as(buyer),
      body: {},
      expect: 200,
    });
    return `${r.json.added.length} added, ${r.json.skipped.length} skipped`;
  });
}

// ─── 2. Failed M-Pesa, retry, then cancel with a full refund ────────────────

if (slot) {
  const failing = await step('a payment that fails at M-Pesa is reported as failed', async () => {
    const placed = await placeOrder(1, FAILING_PHONE);
    const status =
      (await poll(async () => {
        const s = (await checkout(placed.checkoutId)).payment.status;
        return s === 'FAILED' ? s : null;
      })) ?? (await checkout(placed.checkoutId)).payment.status;
    if (status !== 'FAILED') throw new Error(`payment status ${status}`);
    return placed;
  });
  if (failing) {
    await step('the buyer retries with another number and it succeeds', async () => {
      await call('POST', `/v1/checkouts/${failing.checkoutId}/pay`, {
        ...as(buyer),
        body: { phoneNumber: GOOD_PHONE },
        expect: 202,
      });
      await waitPaid(failing.checkoutId);
    });
    await step('cancelling a paid order refunds it in full', async () => {
      await call('POST', `/v1/orders/${failing.orderId}/cancel`, {
        ...as(buyer),
        body: { reason: 'Smoke test: plans changed' },
        expect: 200,
      });
      const refunded = await poll(async () => {
        const o = (await checkout(failing.checkoutId)).orders.find((x) => x.id === failing.orderId);
        return o && o.refundedAmount >= o.total && o.status === 'CANCELLED' ? o : null;
      });
      if (!refunded) throw new Error('order not cancelled and fully refunded');
      return `${refunded.refundedAmount} cents back`;
    });
  }
}

// ─── 3. Partial QA acceptance, then a dispute refund ────────────────────────

if (slot && farmer) {
  const partial = await step('partial order placed and paid', async () => {
    const placed = await placeOrder(4, GOOD_PHONE);
    await waitPaid(placed.checkoutId);
    await farmerPrepares(placed.orderId);
    return placed;
  });
  if (partial) {
    await step('QA accepts half, and the buyer is refunded for the rest', async () => {
      const o = await inspect(partial.orderId, 0.5);
      if (o.status !== 'QA_PASSED') throw new Error(`status ${o.status}`);
      const refunded = await poll(async () => {
        const row = (await checkout(partial.checkoutId)).orders.find((x) => x.id === partial.orderId);
        return row && row.refundedAmount > 0 ? row : null;
      });
      if (!refunded) throw new Error('no refund for the rejected half');
      return `${refunded.refundedAmount} cents back`;
    });
    await step('buyer reports a problem after delivery', async () => {
      await deliver(partial.orderId);
      await call('POST', `/v1/orders/${partial.orderId}/dispute`, {
        ...as(buyer),
        body: {
          reason: 'QUALITY',
          description: 'Smoke test: some leaves were wilted on arrival.',
          photos: [],
        },
        expect: 201,
      });
    });
    await step('admin resolves the dispute with a partial refund', async () => {
      const before = (await checkout(partial.checkoutId)).orders.find((x) => x.id === partial.orderId);
      const list = await call('GET', '/v1/admin/disputes?open=true&limit=50', { token: admin, expect: 200 });
      const dispute = list.json.items.find((d) => d.orderId === partial.orderId);
      if (!dispute) throw new Error('dispute not in the admin list');
      const body = { outcome: 'REFUND', refundAmount: 100, resolution: 'Smoke test: one shilling back' };
      const r = await call('POST', `/v1/admin/disputes/${dispute.id}/resolve`, { token: admin, body });
      if (r.status === 409) {
        await call('POST', `/v1/admin/disputes/${dispute.id}/review`, {
          token: admin,
          body: {},
          expect: 200,
        });
        await call('POST', `/v1/admin/disputes/${dispute.id}/resolve`, { token: admin, body, expect: 200 });
      } else if (r.status !== 200) {
        throw new Error(`resolve returned ${r.status} ${r.json?.error?.code ?? ''}`);
      }
      const after = await poll(async () => {
        const row = (await checkout(partial.checkoutId)).orders.find((x) => x.id === partial.orderId);
        return row && row.refundedAmount >= before.refundedAmount + 100 ? row : null;
      });
      if (!after) throw new Error('refund did not reach the buyer');
    });
  }
}

// ─── 4. Every role's home loads ─────────────────────────────────────────────

if (admin) {
  const homes = [
    ['farmer', 'Mary Wambui', '/v1/dashboard/farmer'],
    ['agent', 'Kamau Agent', '/v1/dashboard/agent'],
    ['driver', 'Otieno Driver', '/v1/dashboard/driver'],
    ['input_supplier', 'Brian Green', '/v1/dashboard/supplier'],
  ];
  for (const [role, name, path] of homes) {
    await step(`${role} home loads`, async () => {
      const t = await impersonate(admin, await userId(admin, role, name));
      await call('GET', path, { token: t, org: await firstOrg(t), expect: 200 });
    });
  }
  await step('QA officer home loads', async () => {
    await call('GET', '/v1/dashboard/qa', { token: qa, expect: 200 });
  });
  await step('admin overview loads', async () => {
    await call('GET', '/v1/admin/summary', { token: admin, expect: 200 });
  });
}

// ─── 5. Accounts and security ───────────────────────────────────────────────

if (slot) {
  await step('an account with an open order cannot be deleted', async () => {
    const open = await call('POST', '/v1/orders', {
      ...as(buyer),
      body: { listingId: listing.id, quantity: 1 },
      expect: 201,
    });
    try {
      const r = await call('POST', '/v1/me/delete-request', { ...as(buyer), body: {}, expect: 409 });
      return r.json?.error?.code ?? '';
    } finally {
      await call('POST', `/v1/orders/${open.json.id}/cancel`, {
        ...as(buyer),
        body: { reason: 'Smoke test cleanup' },
        expect: 200,
      });
    }
  });
}
await step('a new account with nothing open can be deleted', async () => {
  const email = `smoke-${Date.now()}@example.test`;
  const password = `Smoke-${crypto.randomUUID()}`;
  const up = await call('POST', '/api/auth/sign-up/email', {
    body: { name: 'Smoke Test', email, password },
    expect: 200,
  });
  const token = up.json?.token ?? (await signIn(email, password));
  await call('POST', '/v1/me/delete-request', { token, body: {}, expect: 200 });
  await call('GET', '/v1/me', { token, expect: 401 });
});
await step('a buyer cannot list payouts (admin only)', async () => {
  await call('GET', '/v1/admin/payouts', { ...as(buyer), expect: 403 });
});
await step('signed-out requests are refused', async () => {
  await call('GET', '/v1/orders', { expect: 401 });
});
await step('an M-Pesa callback without its token is refused', async () => {
  const r = await call('POST', '/webhooks/mpesa/stk', { body: {} });
  if (r.status < 400) throw new Error(`accepted with ${r.status}`);
  return `${r.status}`;
});

console.log(`\n${results.length - failed} of ${results.length} steps passed.`);
process.exit(failed ? 1 : 0);
