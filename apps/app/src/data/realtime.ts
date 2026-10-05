import { WS_CLOSE } from '@farmgo/contracts';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { WS_URL } from '../lib/config';
import { queryClient } from './query';
import { useSession } from './session';

type Handler = (type: string, data: Record<string, unknown>, channel: string) => void;
const listeners = new Set<Handler>();

/** Subscribe a screen to raw realtime events (e.g. live driver location on Track Order). */
export function onRealtime(h: Handler) {
  listeners.add(h);
  return () => {
    listeners.delete(h);
  };
}

let socket: WebSocket | null = null;
const lastSeq = new Map<string, number>();
const extraChannels = new Set<string>();

/** Join an extra channel (order:{id}, route:{id}) while a screen is open. */
export function joinChannel(channel: string) {
  extraChannels.add(channel);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ op: 'subscribe', channel, lastSeq: lastSeq.get(channel) }));
  }
  return () => {
    extraChannels.delete(channel);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 'unsubscribe', channel }));
  };
}

export function sendLocation(ping: {
  routeId: string;
  lat: number;
  lng: number;
  heading?: number;
  speedKph?: number;
}) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ op: 'location', ...ping }));
    return true;
  }
  return false;
}

/** Map a server event to the cached data it makes stale. */
function invalidateFor(type: string, data: Record<string, unknown>) {
  const inv = (key: unknown[]) => void queryClient.invalidateQueries({ queryKey: key });
  if (type.startsWith('order.')) {
    inv(['orders']);
    if (data.orderId) inv(['order', data.orderId]);
    inv(['dashboard']);
    if (type === 'order.message') {
      inv(['messages', data.orderId]);
      inv(['badges']);
    }
    inv(['conversations']);
  }
  if (type.startsWith('match.')) {
    inv(['matches']);
    inv(['dashboard']);
    inv(['demand']);
  }
  if (type.startsWith('demand.')) inv(['demand']);
  if (type.startsWith('supply.')) inv(['listings']);
  if (type.startsWith('payment.')) {
    inv(['payments']);
    if (data.orderId) inv(['order', data.orderId]);
    inv(['invoices']);
  }
  if (type.startsWith('payout.')) {
    inv(['payouts']);
    inv(['earnings']);
    inv(['dashboard']);
  }
  if (type.startsWith('route.') || type === 'delivery.stop_updated') {
    inv(['routes']);
    if (data.orderId) inv(['order', data.orderId]);
  }
  if (type === 'notification.new') {
    inv(['notifications']);
    inv(['badges']);
  }
  if (type.startsWith('input_order.')) inv(['inputOrders']);
  if (type.startsWith('dispute.')) {
    inv(['orders']);
    if (data.orderId) inv(['order', data.orderId]);
  }
}

/**
 * One WebSocket per signed-in app. Reconnects with backoff, resubscribes extra channels
 * with their last sequence number, and refreshes cached data when events arrive.
 */
export function useRealtimeConnection() {
  const token = useSession((s) => s.token);
  const signedIn = useSession((s) => s.status === 'signedIn');

  useEffect(() => {
    if (!token || !signedIn) return;
    let closedByUs = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      // The token travels as a WebSocket subprotocol, never in the URL, so it can't end up in
      // server or proxy logs. The server agrees to "farmgo.bearer" and reads the second value.
      const ws = new WebSocket(WS_URL, ['farmgo.bearer', encodeURIComponent(token)]);
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"op":"ping"}'), 20_000);
      };
      ws.onmessage = (e) => {
        let msg: { op: string; type?: string; data?: unknown; channel?: string; seq?: number };
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        // Subscribe after the server's hello: it drops messages sent before auto-join finishes.
        if (msg.op === 'hello') {
          for (const ch of extraChannels)
            ws.send(JSON.stringify({ op: 'subscribe', channel: ch, lastSeq: lastSeq.get(ch) }));
          return;
        }
        if (msg.op !== 'event' || !msg.type || !msg.channel) return;
        if (msg.seq) lastSeq.set(msg.channel, Math.max(lastSeq.get(msg.channel) ?? 0, msg.seq));
        const data = (msg.data ?? {}) as Record<string, unknown>;
        if (msg.type === 'resync') {
          void queryClient.invalidateQueries();
          return;
        }
        invalidateFor(msg.type, data);
        for (const l of listeners) l(msg.type, data, msg.channel);
      };
      ws.onclose = (e) => {
        if (ping) clearInterval(ping);
        socket = null;
        if (closedByUs || e.code === WS_CLOSE.UNAUTHORIZED) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !socket) connect();
    });
    return () => {
      closedByUs = true;
      appSub.remove();
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      socket?.close();
      socket = null;
    };
  }, [token, signedIn]);
}
