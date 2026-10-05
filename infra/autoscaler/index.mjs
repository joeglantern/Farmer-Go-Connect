/**
 * FarmGo API autoscaler for a single Docker host.
 *
 * Every AUTOSCALE_INTERVAL_S it reads CPU for each `api` container (Docker stats) and the API's
 * p95 latency (Prometheus, optional), asks decide.mjs what to do, and adds or removes one replica.
 * A new replica is a copy of the newest running one (same image, env, limits and network alias),
 * so Caddy finds it through Docker DNS. A removed replica gets SIGTERM and drains first.
 * It talks to Docker only through the socket proxy, and pauses while infra/deploy.sh holds
 * /state/deploy.lock.
 */
import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { decide, initialState } from './decide.mjs';

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => Number(env(k, d));

const cfg = {
  project: env('COMPOSE_PROJECT', 'farmgo-prod'),
  service: env('SERVICE', 'api'),
  docker: new URL(env('DOCKER_HOST', 'tcp://docker-proxy:2375').replace(/^tcp:/, 'http:')),
  prometheus: env('PROMETHEUS_URL', ''),
  min: num('AUTOSCALE_MIN', 2),
  max: num('AUTOSCALE_MAX', 4),
  cpuUp: num('AUTOSCALE_CPU_UP', 70),
  cpuDown: num('AUTOSCALE_CPU_DOWN', 25),
  p95UpMs: num('AUTOSCALE_P95_UP_MS', 800),
  p95DownMs: num('AUTOSCALE_P95_DOWN_MS', 300),
  upSamples: num('AUTOSCALE_UP_SAMPLES', 2),
  upCooldownS: num('AUTOSCALE_UP_COOLDOWN_S', 180),
  downCooldownS: num('AUTOSCALE_DOWN_COOLDOWN_S', 600),
  downSustainS: num('AUTOSCALE_DOWN_SUSTAIN_S', 300),
  intervalS: num('AUTOSCALE_INTERVAL_S', 20),
  pgMaxConnections: num('PG_MAX_CONNECTIONS', 100),
  dbPoolMax: num('DB_POOL_MAX', 10),
  workerPoolMax: num('WORKER_DB_POOL_MAX', 10),
  stopTimeoutS: num('STOP_TIMEOUT_S', 50),
  lockFile: env('DEPLOY_LOCK', '/state/deploy.lock'),
};

const log = (msg, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'autoscaler', msg, ...extra }));

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: cfg.docker.hostname,
        port: cfg.docker.port || 2375,
        method,
        path,
        headers: body ? { 'content-type': 'application/json' } : {},
        timeout: 90_000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`docker ${method} ${path}: ${res.statusCode} ${data}`));
            return;
          }
          resolve(data ? JSON.parse(data) : null);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`docker ${method} ${path}: timeout`)));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const filters = (extra = {}) =>
  encodeURIComponent(
    JSON.stringify({
      label: [`com.docker.compose.project=${cfg.project}`, `com.docker.compose.service=${cfg.service}`],
      ...extra,
    }),
  );

/** Running replicas, newest first. */
async function replicas() {
  const list = await docker('GET', `/containers/json?filters=${filters({ status: ['running'] })}`);
  return list.sort((a, b) => b.Created - a.Created);
}

/** CPU used as a percentage of the container's CPU limit (or of one core without a limit). */
async function cpuPercent(id) {
  const [stats, info] = await Promise.all([
    docker('GET', `/containers/${id}/stats?stream=false`),
    docker('GET', `/containers/${id}/json`),
  ]);
  const cpu = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const system = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cores = stats.cpu_stats.online_cpus || 1;
  if (!(system > 0) || cpu < 0) return null;
  const used = (cpu / system) * cores;
  const limit = info.HostConfig.NanoCpus ? info.HostConfig.NanoCpus / 1e9 : 1;
  return (used / limit) * 100;
}

async function p95Ms() {
  if (!cfg.prometheus) return null;
  const q =
    'histogram_quantile(0.95, sum by (le) (rate(farmgo_http_request_duration_seconds_bucket{route!~"/ws|/health/.*|/metrics"}[2m])))';
  try {
    const res = await fetch(`${cfg.prometheus}/api/v1/query?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(5000),
    });
    const body = await res.json();
    const v = Number(body?.data?.result?.[0]?.value?.[1]);
    return Number.isFinite(v) ? v * 1000 : null;
  } catch {
    return null;
  }
}

function deployInProgress() {
  if (!existsSync(cfg.lockFile)) return false;
  // A lock older than 30 minutes belongs to a deploy that died; ignore it.
  return Date.now() - statSync(cfg.lockFile).mtimeMs < 30 * 60_000;
}

async function addReplica(template) {
  const t = await docker('GET', `/containers/${template.Id}/json`);
  const all = await docker('GET', `/containers/json?all=true&filters=${filters()}`);
  const used = new Set(all.map((c) => Number(c.Labels['com.docker.compose.container-number'])));
  let n = 1;
  while (used.has(n)) n++;
  const name = `${cfg.project}-${cfg.service}-${n}`;
  const endpoints = {};
  for (const net of Object.keys(t.NetworkSettings.Networks)) {
    endpoints[net] = { Aliases: [cfg.service, name] };
  }
  const { Hostname: _hostname, Domainname: _domain, ...config } = t.Config;
  const created = await docker('POST', `/containers/create?name=${name}`, {
    ...config,
    Labels: {
      ...t.Config.Labels,
      'com.docker.compose.container-number': String(n),
      'farmgo.autoscaled': 'true',
    },
    HostConfig: t.HostConfig,
    NetworkingConfig: { EndpointsConfig: endpoints },
  });
  await docker('POST', `/containers/${created.Id}/start`);
  return name;
}

async function removeReplica(victim) {
  // SIGTERM: readiness fails, Caddy stops routing to it, in-flight requests finish, then it exits.
  await docker('POST', `/containers/${victim.Id}/stop?t=${cfg.stopTimeoutS}`);
  await docker('DELETE', `/containers/${victim.Id}`);
}

let state = initialState();

async function tick() {
  if (deployInProgress()) {
    log('deploy in progress, holding');
    return;
  }
  const running = await replicas();
  if (!running.length) {
    log('no api replicas running; waiting for a deploy');
    return;
  }
  const cpus = (await Promise.all(running.map((c) => cpuPercent(c.Id).catch(() => null)))).filter(
    (v) => v !== null,
  );
  const sample = {
    replicas: running.length,
    cpuPct: cpus.length ? cpus.reduce((a, b) => a + b, 0) / cpus.length : null,
    p95Ms: await p95Ms(),
  };
  const d = decide(state, sample, cfg, Date.now());
  state = d.state;
  if (d.action === 'hold') return;
  log(`scaling ${d.action} to ${d.target}`, { reason: d.reason, ...sample });
  if (d.action === 'up') {
    log('replica started', { name: await addReplica(running[0]) });
  } else {
    // Remove a copy the autoscaler made if there is one, else the newest replica.
    const victim = running.find((c) => c.Labels['farmgo.autoscaled'] === 'true') ?? running[0];
    await removeReplica(victim);
    log('replica removed', { name: victim.Names?.[0] });
  }
}

log('autoscaler started', {
  min: cfg.min,
  max: cfg.max,
  intervalS: cfg.intervalS,
  prometheus: cfg.prometheus || null,
});
let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await tick();
  } catch (err) {
    log('tick failed', { error: String(err?.message ?? err) });
  } finally {
    busy = false;
  }
}, cfg.intervalS * 1000);
process.on('SIGTERM', () => process.exit(0));
