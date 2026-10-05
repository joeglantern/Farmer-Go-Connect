/**
 * The scaling decision, kept free of I/O so it can be tested on its own.
 *
 * Scale up when CPU (as a share of each replica's CPU limit) or p95 latency stays above its
 * threshold for `upSamples` checks in a row. Scale down when both stay below their low marks for
 * `downSustainS` seconds. Each direction has its own cooldown after any change, and the ceiling is
 * also limited by the Postgres connection budget.
 */

/** Most API replicas that fit in Postgres: replicas x pool + worker pool + reserve <= max_connections. */
export function connectionCeiling({ pgMaxConnections, dbPoolMax, workerPoolMax, reserve = 10 }) {
  return Math.max(1, Math.floor((pgMaxConnections - workerPoolMax - reserve) / dbPoolMax));
}

export function initialState() {
  return { upStreak: 0, calmSince: null, lastChangeAt: 0 };
}

/**
 * @param {{ upStreak: number, calmSince: number | null, lastChangeAt: number }} state
 * @param {{ replicas: number, cpuPct: number | null, p95Ms: number | null }} sample
 * @param {object} cfg
 * @param {number} now epoch ms
 * @returns {{ action: 'up' | 'down' | 'hold', target: number, reason: string, state: object }}
 */
export function decide(state, sample, cfg, now) {
  const ceiling = Math.min(cfg.max, connectionCeiling(cfg));
  const floor = Math.min(cfg.min, ceiling);
  const s = { ...state };
  const { replicas, cpuPct, p95Ms } = sample;

  // Below the floor (a replica died, or a deploy is half done): restore at once.
  if (replicas < floor) {
    s.upStreak = 0;
    s.calmSince = null;
    s.lastChangeAt = now;
    return { action: 'up', target: replicas + 1, reason: `below minimum ${floor}`, state: s };
  }
  if (replicas > ceiling) {
    s.lastChangeAt = now;
    return { action: 'down', target: replicas - 1, reason: `above ceiling ${ceiling}`, state: s };
  }

  const hot = (cpuPct !== null && cpuPct > cfg.cpuUp) || (p95Ms !== null && p95Ms > cfg.p95UpMs);
  const calm = cpuPct !== null && cpuPct < cfg.cpuDown && (p95Ms === null || p95Ms < cfg.p95DownMs);

  s.upStreak = hot ? s.upStreak + 1 : 0;
  s.calmSince = calm ? (s.calmSince ?? now) : null;
  const since = (now - s.lastChangeAt) / 1000;
  const detail = `cpu ${cpuPct === null ? 'n/a' : cpuPct.toFixed(0)}%, p95 ${p95Ms === null ? 'n/a' : `${p95Ms.toFixed(0)}ms`}`;

  if (hot && s.upStreak >= cfg.upSamples && replicas < ceiling && since >= cfg.upCooldownS) {
    s.upStreak = 0;
    s.calmSince = null;
    s.lastChangeAt = now;
    return { action: 'up', target: replicas + 1, reason: `busy: ${detail}`, state: s };
  }
  if (
    calm &&
    s.calmSince !== null &&
    (now - s.calmSince) / 1000 >= cfg.downSustainS &&
    replicas > floor &&
    since >= cfg.downCooldownS
  ) {
    s.calmSince = null;
    s.lastChangeAt = now;
    return { action: 'down', target: replicas - 1, reason: `quiet: ${detail}`, state: s };
  }
  return { action: 'hold', target: replicas, reason: detail, state: s };
}
