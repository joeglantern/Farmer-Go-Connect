import { z } from 'zod';

/**
 * Where a notification opens in the app. Every notification's `data` carries `route` and `params`
 * (and the API also returns them as `link`), so a tap goes straight to the right screen:
 *   order { id, section? } · match { id } · payout { orderId } | { inputOrderId } · route { id }
 *   demand { id } · demandBoard { produceId, county } · inputOrder { id } · checkout { id }
 *   invoice { id } · crates {} · profile {}
 */
export const DEEP_LINK_ROUTES = [
  'order',
  'match',
  'payout',
  'route',
  'demand',
  'demandBoard',
  'inputOrder',
  'checkout',
  'invoice',
  'crates',
  'profile',
] as const;
export const DeepLinkRoute = z.enum(DEEP_LINK_ROUTES);
export type DeepLinkRoute = z.infer<typeof DeepLinkRoute>;

export const DeepLink = z.object({ route: DeepLinkRoute, params: z.record(z.string(), z.string()) });
export type DeepLink = z.infer<typeof DeepLink>;
