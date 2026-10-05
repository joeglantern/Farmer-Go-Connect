import type { ListingDto } from '@farmgo/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Buyer cart. Lives on the device and survives restarts. Checkout sends these lines as explicit
 * items, and the server re-prices them, so a stale device cart can never be charged wrongly.
 */
export interface CartLine {
  listingId: string;
  quantity: number;
  /** Snapshot for display; prices are re-checked by the server at checkout. */
  produce: {
    id: string;
    name: string;
    nameSw: string;
    unit: string;
    category: string;
    imageUrl: string | null;
  };
  farm: { id: string; name: string; county: string; farmerName: string };
  pricePerUnit: number;
  available: number;
  photoUrl: string | null;
  addedAt: number;
}

interface CartState {
  lines: CartLine[];
  add: (l: ListingDto, quantity: number) => void;
  setQuantity: (listingId: string, quantity: number) => void;
  remove: (listingId: string) => CartLine | undefined;
  restore: (line: CartLine) => void;
  clear: () => void;
  quantityOf: (listingId: string) => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      add: (l, quantity) =>
        set((s) => {
          const existing = s.lines.find((x) => x.listingId === l.id);
          const available = Number(l.quantityLeft);
          if (existing) {
            return {
              lines: s.lines.map((x) =>
                x.listingId === l.id
                  ? {
                      ...x,
                      quantity: Math.min(available, x.quantity + quantity),
                      available,
                      pricePerUnit: l.pricePerUnit,
                    }
                  : x,
              ),
            };
          }
          return {
            lines: [
              ...s.lines,
              {
                listingId: l.id,
                quantity: Math.min(available, quantity),
                produce: {
                  id: l.produce.id,
                  name: l.produce.name,
                  nameSw: l.produce.nameSw,
                  unit: l.produce.unit,
                  category: l.produce.category,
                  imageUrl: l.produce.imageUrl ?? null,
                },
                farm: {
                  id: l.farm.id,
                  name: l.farm.name,
                  county: l.farm.county,
                  farmerName: l.farm.farmer.user.name,
                },
                pricePerUnit: l.pricePerUnit,
                available,
                photoUrl: l.photoUrls?.[0] ?? l.produce.imageUrl ?? null,
                addedAt: Date.now(),
              },
            ],
          };
        }),
      setQuantity: (listingId, quantity) =>
        set((s) => ({
          lines:
            quantity <= 0
              ? s.lines.filter((x) => x.listingId !== listingId)
              : s.lines.map((x) =>
                  x.listingId === listingId ? { ...x, quantity: Math.min(x.available, quantity) } : x,
                ),
        })),
      remove: (listingId) => {
        const line = get().lines.find((x) => x.listingId === listingId);
        set((s) => ({ lines: s.lines.filter((x) => x.listingId !== listingId) }));
        return line;
      },
      restore: (line) =>
        set((s) => ({
          lines: [...s.lines.filter((x) => x.listingId !== line.listingId), line].sort(
            (a, b) => a.addedAt - b.addedAt,
          ),
        })),
      clear: () => set({ lines: [] }),
      quantityOf: (listingId) => get().lines.find((x) => x.listingId === listingId)?.quantity ?? 0,
    }),
    { name: 'farmgo.cart', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);

export function cartTotals(lines: CartLine[]) {
  const subtotal = lines.reduce((s, l) => s + Math.round(l.quantity * l.pricePerUnit), 0);
  const count = lines.length;
  const farms = new Map<string, CartLine[]>();
  for (const l of lines) farms.set(l.farm.id, [...(farms.get(l.farm.id) ?? []), l]);
  return {
    subtotal,
    count,
    byFarm: [...farms.entries()].map(([farmId, items]) => ({ farmId, farm: items[0]!.farm, items })),
  };
}
