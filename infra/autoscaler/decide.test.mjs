import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionCeiling, decide, initialState } from './decide.mjs';

const cfg = {
  min: 2,
  max: 6,
  cpuUp: 70,
  cpuDown: 25,
  p95UpMs: 800,
  p95DownMs: 300,
  upSamples: 2,
  upCooldownS: 180,
  downCooldownS: 600,
  downSustainS: 300,
  pgMaxConnections: 100,
  dbPoolMax: 10,
  workerPoolMax: 10,
};
const T0 = 1_000_000_000_000;
const sec = (n) => T0 + n * 1000;

test('the connection budget caps replicas', () => {
  assert.equal(connectionCeiling(cfg), 8);
  assert.equal(connectionCeiling({ ...cfg, pgMaxConnections: 50 }), 3);
  const d = decide(
    initialState(),
    { replicas: 3, cpuPct: 95, p95Ms: 2000 },
    { ...cfg, pgMaxConnections: 50 },
    sec(1000),
  );
  assert.equal(d.action, 'hold');
});

test('restores the minimum at once', () => {
  const d = decide(initialState(), { replicas: 1, cpuPct: 5, p95Ms: 50 }, cfg, sec(0));
  assert.deepEqual([d.action, d.target], ['up', 2]);
});

test('scales up only after sustained load and respects the cooldown', () => {
  let s = { ...initialState(), lastChangeAt: sec(0) };
  let d = decide(s, { replicas: 2, cpuPct: 90, p95Ms: 200 }, cfg, sec(200));
  assert.equal(d.action, 'hold'); // first hot sample
  d = decide(d.state, { replicas: 2, cpuPct: 90, p95Ms: 200 }, cfg, sec(220));
  assert.deepEqual([d.action, d.target], ['up', 3]);
  // Still hot right after: cooldown holds.
  s = d.state;
  d = decide(s, { replicas: 3, cpuPct: 90, p95Ms: 200 }, cfg, sec(240));
  d = decide(d.state, { replicas: 3, cpuPct: 90, p95Ms: 200 }, cfg, sec(260));
  assert.equal(d.action, 'hold');
  d = decide(d.state, { replicas: 3, cpuPct: 90, p95Ms: 200 }, cfg, sec(420));
  assert.equal(d.action, 'up');
});

test('latency alone triggers a scale up', () => {
  let d = decide(initialState(), { replicas: 2, cpuPct: 30, p95Ms: 1500 }, cfg, sec(1000));
  d = decide(d.state, { replicas: 2, cpuPct: 30, p95Ms: 1500 }, cfg, sec(1020));
  assert.equal(d.action, 'up');
});

test('scales down after a sustained quiet spell, never below the minimum', () => {
  let d = decide(
    { ...initialState(), lastChangeAt: sec(0) },
    { replicas: 3, cpuPct: 10, p95Ms: 80 },
    cfg,
    sec(700),
  );
  assert.equal(d.action, 'hold'); // quiet just started
  d = decide(d.state, { replicas: 3, cpuPct: 10, p95Ms: 80 }, cfg, sec(1010));
  assert.deepEqual([d.action, d.target], ['down', 2]);
  d = decide({ ...initialState() }, { replicas: 2, cpuPct: 1, p95Ms: 10 }, cfg, sec(5000));
  d = decide(d.state, { replicas: 2, cpuPct: 1, p95Ms: 10 }, cfg, sec(9000));
  assert.equal(d.action, 'hold');
});

test('a busy moment resets the quiet spell', () => {
  let d = decide({ ...initialState() }, { replicas: 3, cpuPct: 10, p95Ms: 80 }, cfg, sec(1000));
  d = decide(d.state, { replicas: 3, cpuPct: 50, p95Ms: 80 }, cfg, sec(1200));
  d = decide(d.state, { replicas: 3, cpuPct: 10, p95Ms: 80 }, cfg, sec(1310));
  assert.equal(d.action, 'hold');
});

test('without Prometheus it still scales on CPU', () => {
  let d = decide(initialState(), { replicas: 2, cpuPct: 85, p95Ms: null }, cfg, sec(1000));
  d = decide(d.state, { replicas: 2, cpuPct: 85, p95Ms: null }, cfg, sec(1020));
  assert.equal(d.action, 'up');
});
