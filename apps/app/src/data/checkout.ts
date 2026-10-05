import type {
  CheckoutAddress,
  CheckoutItem,
  CheckoutLineDto,
  CheckoutPaymentMethod,
  CheckoutQuoteDto,
  CheckoutResultDto,
} from '@farmgo/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CartLine } from './cart';

/** B07 contract, from packages/contracts/src/dto/checkout.ts. */
export type PayMethod = CheckoutPaymentMethod;
export type { CheckoutAddress };
export type QuoteItem = CheckoutLineDto;
export type CheckoutQuote = CheckoutQuoteDto;
export type CheckoutResult = CheckoutResultDto;

export interface CheckoutBody {
  items: CheckoutItem[];
  addressId?: string;
  address?: CheckoutAddress;
  deliveryDate: string;
  deliveryWindow: string;
}

export const DEFAULT_DELIVERY_FEE = 30_000;

/** Delivery fee shown in the cart before a quote exists. */
export function useDeliveryFee() {
  return DEFAULT_DELIVERY_FEE;
}

/** Cart lines to checkout items. The price the buyer saw goes along so a change is reported. */
export function toItems(lines: CartLine[]): CheckoutItem[] {
  return lines.map((l) => ({ listingId: l.listingId, quantity: l.quantity, pricePerUnit: l.pricePerUnit }));
}

export function useQuote(body: CheckoutBody | null) {
  return useQuery({
    queryKey: ['checkoutQuote', body],
    enabled: !!body && body.items.length > 0,
    queryFn: () => api.post<CheckoutQuote>('/v1/checkout/quote', body),
    retry: false,
  });
}

export const placeCheckout = (
  body: CheckoutBody & { paymentMethod: PayMethod; phoneNumber?: string; notes?: string },
  idempotencyKey: string,
) => api.post<CheckoutResult>('/v1/checkout', body, { idempotencyKey });

/**
 * The M-Pesa number typed at checkout, so "Try again" on the payment screen starts from it
 * instead of the account phone. Kept in memory only (never in the URL).
 */
let lastMpesaPhone: string | null = null;
export const rememberMpesaPhone = (phone: string | null) => {
  lastMpesaPhone = phone;
};
export const rememberedMpesaPhone = () => lastMpesaPhone;

export const getCheckout = (id: string) => api.get<CheckoutResult>(`/v1/checkouts/${id}`);

export interface Slot {
  date: string; // YYYY-MM-DD
  windows: { value: string; label: string; available: boolean; reason?: string }[];
}

/** Delivery slots from GET /v1/delivery/slots (B09): cut-off and windows come from settings. */
export function useSlots(county?: string) {
  return useQuery({
    queryKey: ['slots', county],
    queryFn: async ({ signal }): Promise<Slot[]> => {
      const res = await api.get<{
        days: {
          date: string;
          available: boolean;
          windows: { window: string; available: boolean; reason: string | null }[];
        }[];
      }>('/v1/delivery/slots', { days: 9, county }, signal);
      return res.days
        .filter((d) => d.available)
        .map((d) => ({
          date: d.date,
          windows: d.windows.map((w) => ({
            value: w.window,
            label: w.window.replace('-', ' to '),
            available: w.available,
            reason: w.reason ?? undefined,
          })),
        }));
    },
    staleTime: 300_000,
  });
}
