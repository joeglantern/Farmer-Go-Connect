import type { DeepLink } from '@farmgo/contracts';
import type { Href } from 'expo-router';

/**
 * Where a notification opens (B14). One map for the in-app inbox and for push taps, so both
 * always agree. Returns null for links this build does not know, which then open nothing.
 */
export function hrefForLink(link: DeepLink | null | undefined, role?: string | null): Href | null {
  if (!link) return null;
  const p = link.params ?? {};
  switch (link.route) {
    case 'order':
      if (!p.id) return null;
      return p.section === 'messages'
        ? { pathname: '/chat/[orderId]', params: { orderId: p.id } }
        : { pathname: '/order/[id]', params: { id: p.id } };
    case 'match':
      return '/matches';
    case 'payout':
      return '/earnings';
    case 'route':
      return p.id ? { pathname: '/route/[id]', params: { id: p.id } } : null;
    case 'demand':
      return p.id ? { pathname: '/requirements/[id]', params: { id: p.id } } : '/requirements';
    case 'demandBoard':
      return { pathname: '/demand-board', params: { produceId: p.produceId ?? '', county: p.county ?? '' } };
    case 'inputOrder':
      // Suppliers handle input orders; everyone else placed them.
      return role === 'input_supplier' ? '/input-orders' : '/inputs';
    case 'checkout':
      return p.id ? { pathname: '/payment/[checkoutId]', params: { checkoutId: p.id } } : null;
    case 'invoice':
      return p.id ? { pathname: '/invoices/[id]', params: { id: p.id } } : '/invoices';
    case 'crates':
      return '/scan';
    case 'profile':
      return '/profile';
    default:
      return null;
  }
}

/** Read a link from a push payload or a stored notification's `data`. */
export function linkFromData(data: unknown): DeepLink | null {
  const d = (data ?? {}) as { route?: unknown; params?: unknown };
  if (typeof d.route !== 'string') return null;
  const params = d.params && typeof d.params === 'object' ? (d.params as Record<string, string>) : {};
  return { route: d.route as DeepLink['route'], params };
}
