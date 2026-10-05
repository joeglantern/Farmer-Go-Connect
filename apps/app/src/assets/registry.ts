/**
 * Every bundled image the app uses, by key. Sliced from the ChatGPT sheets in
 * design/generated/ by design/slice_assets.py. A null entry means the art has not been made
 * yet, and the component renders its designed fallback.
 */
import type { ImageSource } from 'expo-image';

type Maybe = ImageSource | number | null;

export const images = {
  heroWelcome: require('./img/photos/hero-welcome.webp') as Maybe,
  handover: require('./img/photos/handover.webp') as Maybe,
  handoverWide: require('./img/photos/handover-wide.webp') as Maybe,
  splashField: require('./img/farms/rows-aerial.webp') as Maybe,
  banners: [
    require('./img/banners/banner-1.webp'),
    require('./img/banners/banner-2.webp'),
    require('./img/banners/banner-3.webp'),
  ] as Maybe[],
  categories: {
    vegetables: require('./img/categories/vegetables.webp') as Maybe,
    fruits: require('./img/categories/fruits.webp') as Maybe,
    'meat-poultry': require('./img/categories/meat-poultry.webp') as Maybe,
    dairy: require('./img/categories/dairy.webp') as Maybe,
    'grains-staples': require('./img/categories/grains-staples.webp') as Maybe,
    'value-added': require('./img/categories/value-added.webp') as Maybe,
    'natural-fertilizers': require('./img/categories/natural-fertilizers.webp') as Maybe,
    all: require('./img/categories/all.webp') as Maybe,
  },
  roles: {
    hotel: require('./img/roles/hotel.webp') as Maybe,
    farmer: require('./img/roles/farmer.webp') as Maybe,
    youth: require('./img/roles/youth.webp') as Maybe,
    household: require('./img/roles/household.webp') as Maybe,
  },
  // Batch 7 (states sheet) has not been generated yet: EmptyState draws its icon fallback.
  states: {
    emptyCart: null as Maybe,
    noOrders: null as Maybe,
    noMessages: null as Maybe,
    noNotifications: null as Maybe,
    noResults: null as Maybe,
    noListings: null as Maybe,
    noMatches: null as Maybe,
    noRoutes: null as Maybe,
    offline: null as Maybe,
    error: null as Maybe,
    orderPlaced: null as Maybe,
    paymentReceived: null as Maybe,
  },
  badges: {
    qualityChecked: require('./img/badges/qualityChecked.webp') as Maybe,
    organic: require('./img/badges/organic.webp') as Maybe,
    local: require('./img/badges/local.webp') as Maybe,
    youthLed: require('./img/badges/youthLed.webp') as Maybe,
    womanLed: require('./img/badges/womanLed.webp') as Maybe,
    verified: require('./img/badges/verified.webp') as Maybe,
  },
  patterns: {
    leaves: require('./img/patterns/leaves.webp') as Maybe,
    rows: require('./img/patterns/rows.webp') as Maybe,
    paper: require('./img/patterns/paper.webp') as Maybe,
    linen: require('./img/patterns/linen.webp') as Maybe,
  },
  /** Demo farmer portraits (replaced by real profile photos). */
  farmers: [
    require('./img/farmers/farmer-1.webp'),
    require('./img/farmers/farmer-2.webp'),
    require('./img/farmers/farmer-3.webp'),
    require('./img/farmers/farmer-4.webp'),
    require('./img/farmers/farmer-5.webp'),
    require('./img/farmers/farmer-6.webp'),
  ] as Maybe[],
  farms: {
    orchard: require('./img/farms/orchard.webp') as Maybe,
    nursery: require('./img/farms/nursery.webp') as Maybe,
    rows: require('./img/farms/rows-aerial.webp') as Maybe,
  },
};

/** Catalog photos keyed by produce slug (packages/api catalog). */
export const produceImages: Record<string, ImageSource | number> = {
  arrowroots: require('./img/produce/arrowroots.webp'),
  avocados: require('./img/produce/avocados.webp'),
  bananas: require('./img/produce/bananas.webp'),
  'beans-dry': require('./img/produce/beans-dry.webp'),
  beef: require('./img/produce/beef.webp'),
  cabbage: require('./img/produce/cabbage.webp'),
  capsicum: require('./img/produce/capsicum.webp'),
  carrots: require('./img/produce/carrots.webp'),
  chicken: require('./img/produce/chicken.webp'),
  coriander: require('./img/produce/coriander.webp'),
  courgettes: require('./img/produce/courgettes.webp'),
  'dried-mango': require('./img/produce/dried-mango.webp'),
  eggs: require('./img/produce/eggs.webp'),
  'french-beans': require('./img/produce/french-beans.webp'),
  garlic: require('./img/produce/garlic.webp'),
  ghee: require('./img/produce/ghee.webp'),
  ginger: require('./img/produce/ginger.webp'),
  'goat-meat': require('./img/produce/goat-meat.webp'),
  'green-grams': require('./img/produce/green-grams.webp'),
  honey: require('./img/produce/honey.webp'),
  kale: require('./img/produce/kale.webp'),
  maize: require('./img/produce/maize.webp'),
  managu: require('./img/produce/managu.webp'),
  mangoes: require('./img/produce/mangoes.webp'),
  milk: require('./img/produce/milk.webp'),
  'onions-red': require('./img/produce/onions-red.webp'),
  'passion-fruit': require('./img/produce/passion-fruit.webp'),
  'peanut-butter': require('./img/produce/peanut-butter.webp'),
  pineapples: require('./img/produce/pineapples.webp'),
  potatoes: require('./img/produce/potatoes.webp'),
  spinach: require('./img/produce/spinach.webp'),
  'sweet-potatoes': require('./img/produce/sweet-potatoes.webp'),
  terere: require('./img/produce/terere.webp'),
  tomatoes: require('./img/produce/tomatoes.webp'),
  watermelon: require('./img/produce/watermelon.webp'),
  yoghurt: require('./img/produce/yoghurt.webp'),
};

/** Words in a produce name that identify its photo, for rows that carry a name but no slug. */
const NAME_HINTS: [RegExp, string][] = [
  [/tomato/i, 'tomatoes'],
  [/onion/i, 'onions-red'],
  [/kale|sukuma/i, 'kale'],
  [/spinach/i, 'spinach'],
  [/cabbage/i, 'cabbage'],
  [/carrot/i, 'carrots'],
  [/capsicum|pepper|pilipili hoho/i, 'capsicum'],
  [/french bean|mishiri/i, 'french-beans'],
  [/courgette|zucchini/i, 'courgettes'],
  [/sweet potato|viazi vitamu/i, 'sweet-potatoes'],
  [/potato|viazi/i, 'potatoes'],
  [/avocado|parachichi/i, 'avocados'],
  [/banana|ndizi/i, 'bananas'],
  [/dried mango/i, 'dried-mango'],
  [/mango|embe/i, 'mangoes'],
  [/passion/i, 'passion-fruit'],
  [/pineapple|nanasi/i, 'pineapples'],
  [/watermelon|tikiti/i, 'watermelon'],
  [/coriander|dhania/i, 'coriander'],
  [/ginger|tangawizi/i, 'ginger'],
  [/garlic|kitunguu saumu/i, 'garlic'],
  [/green gram|ndengu/i, 'green-grams'],
  [/bean|maharagwe/i, 'beans-dry'],
  [/maize|mahindi/i, 'maize'],
  [/egg|mayai/i, 'eggs'],
  [/yoghurt|yogurt|mtindi/i, 'yoghurt'],
  [/milk|maziwa/i, 'milk'],
  [/honey|asali/i, 'honey'],
  [/peanut/i, 'peanut-butter'],
  [/ghee/i, 'ghee'],
  [/beef|nyama ya ng'ombe/i, 'beef'],
  [/goat|mbuzi/i, 'goat-meat'],
  [/chicken|kuku/i, 'chicken'],
  [/arrowroot|nduma/i, 'arrowroots'],
  [/managu|nightshade/i, 'managu'],
  [/terere|amaranth/i, 'terere'],
];

/** Bundled catalog photo for a produce item, by slug first, then by name. */
export function produceArt(p?: { slug?: string | null; name?: string | null } | null) {
  if (!p) return null;
  if (p.slug && produceImages[p.slug]) return produceImages[p.slug]!;
  const hit = p.name ? NAME_HINTS.find(([re]) => re.test(p.name!)) : undefined;
  return hit ? (produceImages[hit[1]] ?? null) : null;
}

export type CategorySlug = keyof typeof images.categories;
export type StateKey = keyof typeof images.states;
