import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n from '../i18n';
import { api } from '../lib/api';
import { toastOutside } from '../ui/overlays/Toast';
import { queryClient } from './query';

export type FavoriteKind = 'LISTING' | 'FARMER' | 'PRODUCE' | 'CATEGORY';

/**
 * Favorites (B12). The server is the source of truth: `sync()` loads it after sign-in, and
 * `toggle()` updates the device copy at once (hearts respond instantly), then the server.
 */
interface FavoritesState {
  keys: string[];
  has: (kind: FavoriteKind, id: string) => boolean;
  toggle: (kind: FavoriteKind, id: string) => boolean;
  sync: () => Promise<void>;
}

export interface Favorite {
  id: string;
  kind: FavoriteKind;
  targetId: string;
  title: string;
  titleSw: string | null;
  subtitle: string | null;
  imageUrl: string | null;
  /** False once a listing closes, a farmer is banned or a produce is withdrawn. */
  available: boolean;
  createdAt: string;
}

const k = (kind: FavoriteKind, id: string) => `${kind}:${id}`;

export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      keys: [],
      has: (kind, id) => get().keys.includes(k(kind, id)),
      toggle: (kind, id) => {
        const key = k(kind, id);
        const on = !get().keys.includes(key);
        set((s) => ({ keys: on ? [...s.keys, key] : s.keys.filter((x) => x !== key) }));
        const req = on
          ? api.post('/v1/favorites', { kind, targetId: id })
          : api.delete('/v1/favorites', { query: { kind, targetId: id } });
        req
          .then(() => queryClient.invalidateQueries({ queryKey: ['favorites'] }))
          .catch(() => {
            // Put the heart back the way the server has it, and say why.
            set((s) => ({ keys: on ? s.keys.filter((x) => x !== key) : [...s.keys, key] }));
            toastOutside()?.error(
              on ? i18n.t('shop.favoriteSaveFailed') : i18n.t('shop.favoriteRemoveFailed'),
            );
          });
        return on;
      },
      sync: async () => {
        try {
          const list = await api.get<Favorite[]>('/v1/favorites');
          set({ keys: list.map((f) => k(f.kind, f.targetId)) });
        } catch {
          // offline: keep the device copy
        }
      },
    }),
    { name: 'farmgo.favorites', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Full favorites with titles and photos, for the Favorites screen. */
export function useFavoriteList(kind?: FavoriteKind) {
  return useQuery({
    queryKey: ['favorites', kind],
    queryFn: ({ signal }) => api.get<Favorite[]>('/v1/favorites', { kind }, signal),
  });
}
