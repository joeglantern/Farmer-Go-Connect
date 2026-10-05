import * as Location from 'expo-location';
import { useEffect, useSyncExternalStore } from 'react';
import { sendLocation } from '../../data/realtime';
import { api } from '../../lib/api';

export type ShareState = 'off' | 'starting' | 'live' | 'denied' | 'error';

/**
 * One GPS watcher for the whole app while a route is in progress. Every screen that shows the
 * active route calls useLocationSharing(routeId); the watcher stops when the last one leaves.
 * Pings go over the WebSocket, falling back to REST (throttled below the server's rate limit).
 */
let sub: Location.LocationSubscription | null = null;
let current: string | null = null;
let users = 0;
let lastRest = 0;
let state: ShareState = 'off';
let lastFix: number | null = null;
const listeners = new Set<() => void>();

function set(next: ShareState) {
  state = next;
  for (const l of listeners) l();
}

function stop() {
  sub?.remove();
  sub = null;
  current = null;
  set('off');
}

function onPosition(routeId: string, pos: Location.LocationObject) {
  const { latitude, longitude, heading, speed } = pos.coords;
  const ping = {
    routeId,
    lat: Number(latitude.toFixed(6)),
    lng: Number(longitude.toFixed(6)),
    heading: heading != null && heading >= 0 && heading <= 360 ? heading : undefined,
    speedKph: speed != null && speed >= 0 ? Math.min(250, speed * 3.6) : undefined,
  };
  lastFix = Date.now();
  if (state !== 'live') set('live');
  if (sendLocation(ping)) return;
  const now = Date.now();
  if (now - lastRest < 15_000) return;
  lastRest = now;
  const { routeId: _r, ...body } = ping;
  api.post(`/v1/routes/${routeId}/location`, body).catch(() => undefined);
}

async function start(routeId: string) {
  set('starting');
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (current !== routeId) return;
    if (perm.status !== 'granted') {
      set('denied');
      return;
    }
    const s = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 25 },
      (p) => onPosition(routeId, p),
    );
    if (current !== routeId) {
      s.remove();
      return;
    }
    sub = s;
    set('live');
  } catch {
    if (current === routeId) set('error');
  }
}

function acquire(routeId: string) {
  users += 1;
  if (current === routeId && state !== 'denied' && state !== 'error') return;
  sub?.remove();
  sub = null;
  current = routeId;
  void start(routeId);
}

function release() {
  users = Math.max(0, users - 1);
  // Give the next screen a moment to take over before switching the GPS off.
  setTimeout(() => {
    if (users === 0) stop();
  }, 1500);
}

export function retryLocationSharing() {
  if (current) void start(current);
}

export function useLocationSharing(routeId: string | null | undefined) {
  useEffect(() => {
    if (!routeId) return;
    acquire(routeId);
    return release;
  }, [routeId]);
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  return { state: routeId ? s : ('off' as ShareState), lastFix };
}
