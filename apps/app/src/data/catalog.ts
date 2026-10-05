import type { ListingDetailDto, ListingPageDto, ProduceDto } from '@farmgo/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { CategorySlug } from '../assets/registry';
import { ApiError, api } from '../lib/api';
import type { IconName } from '../ui/Icon';

/** The 8 home tiles from the mockup, and which produce categories each covers. */
export const APP_CATEGORIES: {
  slug: CategorySlug;
  labelKey: string;
  icon: IconName;
  produce: string[];
  source: 'produce' | 'inputs' | 'all';
  filters: { key: string; labelKey: string; produce: string[] }[];
}[] = [
  {
    slug: 'vegetables',
    labelKey: 'catalog.cat.vegetables',
    icon: 'leaf',
    produce: ['VEGETABLE', 'HERB'],
    source: 'produce',
    filters: [
      { key: 'leafy', labelKey: 'catalog.filter.leafy', produce: ['VEGETABLE'] },
      { key: 'herbs', labelKey: 'catalog.filter.herbs', produce: ['HERB'] },
    ],
  },
  {
    slug: 'fruits',
    labelKey: 'catalog.cat.fruits',
    icon: 'basket',
    produce: ['FRUIT'],
    source: 'produce',
    filters: [],
  },
  {
    slug: 'meat-poultry',
    labelKey: 'catalog.cat.meat',
    icon: 'storefront',
    produce: ['MEAT', 'POULTRY'],
    source: 'produce',
    filters: [],
  },
  {
    slug: 'dairy',
    labelKey: 'catalog.cat.dairy',
    icon: 'drop',
    produce: ['DAIRY'],
    source: 'produce',
    filters: [],
  },
  {
    slug: 'grains-staples',
    labelKey: 'catalog.cat.grains',
    icon: 'scale',
    produce: ['GRAIN', 'LEGUME', 'TUBER'],
    source: 'produce',
    filters: [
      { key: 'grain', labelKey: 'catalog.filter.grains', produce: ['GRAIN'] },
      { key: 'legume', labelKey: 'catalog.filter.legumes', produce: ['LEGUME'] },
      { key: 'tuber', labelKey: 'catalog.filter.rootCrops', produce: ['TUBER'] },
    ],
  },
  {
    slug: 'value-added',
    labelKey: 'catalog.cat.valueAdded',
    icon: 'sparkle',
    produce: ['VALUE_ADDED'],
    source: 'produce',
    filters: [],
  },
  {
    slug: 'natural-fertilizers',
    labelKey: 'catalog.cat.fertilizers',
    icon: 'sprout',
    produce: [],
    source: 'inputs',
    filters: [],
  },
  { slug: 'all', labelKey: 'catalog.cat.all', icon: 'grid', produce: [], source: 'all', filters: [] },
];

export function categoryBySlug(slug: string) {
  return APP_CATEGORIES.find((c) => c.slug === slug);
}

export function useProduce() {
  return useQuery({
    queryKey: ['produce'],
    queryFn: () => api.get<ProduceDto[]>('/v1/produce'),
    staleTime: 3600_000,
  });
}

export interface SupplyFilters {
  produceId?: string;
  county?: string;
  category?: string;
  q?: string;
  sort?: string;
  organic?: boolean;
  upcoming?: boolean;
  mine?: boolean;
  status?: string;
}

export function useSupply(filters: SupplyFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['supply', filters],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = { ...filters, cursor: pageParam, limit: 20 };
      try {
        return await api.get<ListingPageDto>('/v1/supply', query, signal);
      } catch (err) {
        // "Nearest" needs a location; without one, fall back to the default order (soonest).
        if (err instanceof ApiError && err.code === 'LOCATION_REQUIRED' && filters.sort === 'nearest') {
          return api.get<ListingPageDto>('/v1/supply', { ...query, sort: undefined }, signal);
        }
        throw err;
      }
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useListing(id: string | undefined) {
  return useQuery({
    queryKey: ['listing', id],
    enabled: !!id,
    // B15: the listing plus distance, similar listings, the market price comparison and tags.
    queryFn: () => api.get<ListingDetailDto>(`/v1/supply/${id}`),
  });
}

/** Home "Featured Farmers" (B06): ranked by rating, quality pass rate and recent listings. */
export function useFeaturedFarmers(county?: string) {
  return useQuery({
    queryKey: ['featuredFarmers', county],
    queryFn: async ({ signal }) => {
      const rows = await api.get<
        {
          id: string;
          firstName: string;
          avatarUrl: string | null;
          farmName: string;
          county: string;
          photoUrl: string | null;
          rating: number | null;
          badges: string[];
        }[]
      >('/v1/farmers/featured', { limit: 10, county }, signal);
      return rows.map(
        (r): FeaturedFarmer => ({
          id: r.id,
          firstName: r.firstName,
          farmName: r.farmName,
          county: r.county,
          photoUrl: r.photoUrl ?? r.avatarUrl,
          ratingAvg: r.rating,
          badges: r.badges,
        }),
      );
    },
    staleTime: 600_000,
  });
}

export interface FeaturedFarmer {
  /** Farmer profile id: the /farmer/[id] route and GET /v1/farmers/:id. */
  id: string;
  firstName: string;
  farmName: string;
  county: string;
  photoUrl: string | null;
  ratingAvg: number | null;
  /** youth, woman_led, organic, verified */
  badges?: string[];
}
