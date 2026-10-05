import { z } from 'zod';
import type { InputCategory, ProduceCategory } from './enums.js';

/**
 * The home screen's category tiles, in display order. Produce tiles group catalog categories;
 * "Natural Fertilizers" is the green-inputs marketplace. The app and the API share this list.
 */
export const APP_CATEGORIES = [
  {
    slug: 'vegetables',
    name: 'Vegetables',
    nameSw: 'Mboga',
    source: 'produce',
    produceCategories: ['VEGETABLE', 'HERB'],
  },
  { slug: 'fruits', name: 'Fruits', nameSw: 'Matunda', source: 'produce', produceCategories: ['FRUIT'] },
  {
    slug: 'meat-poultry',
    name: 'Meat & Poultry',
    nameSw: 'Nyama na Kuku',
    source: 'produce',
    produceCategories: ['MEAT', 'POULTRY'],
  },
  { slug: 'dairy', name: 'Dairy', nameSw: 'Maziwa', source: 'produce', produceCategories: ['DAIRY'] },
  {
    slug: 'grains-staples',
    name: 'Grains & Staples',
    nameSw: 'Nafaka na Vyakula Vikuu',
    source: 'produce',
    produceCategories: ['GRAIN', 'LEGUME', 'TUBER'],
  },
  {
    slug: 'value-added',
    name: 'Value Added',
    nameSw: 'Bidhaa Zilizoongezwa Thamani',
    source: 'produce',
    produceCategories: ['VALUE_ADDED'],
  },
  {
    slug: 'natural-fertilizers',
    name: 'Natural Fertilizers',
    nameSw: 'Mbolea Asilia',
    source: 'inputs',
    inputCategories: ['COMPOST', 'ORGANIC_FERTILIZER', 'BIOPESTICIDE', 'SEEDLINGS'],
  },
  { slug: 'all', name: 'All Products', nameSw: 'Bidhaa Zote', source: 'produce', produceCategories: [] },
] as const satisfies readonly {
  slug: string;
  name: string;
  nameSw: string;
  source: 'produce' | 'inputs';
  produceCategories?: readonly z.infer<typeof ProduceCategory>[];
  inputCategories?: readonly z.infer<typeof InputCategory>[];
}[];

export const AppCategorySlug = z.enum(APP_CATEGORIES.map((c) => c.slug) as [string, ...string[]]);
export type AppCategorySlug = z.infer<typeof AppCategorySlug>;

/** GET /v1/categories items. `produceCategories` is empty for "all" (every produce). */
export const CategoryDto = z.object({
  slug: z.string(),
  name: z.string(),
  nameSw: z.string(),
  /** Open listings (produce tiles) or active, in-stock products (inputs tile). */
  count: z.number().int(),
  source: z.enum(['produce', 'inputs']),
  produceCategories: z.array(z.string()),
  inputCategories: z.array(z.string()),
});
export type CategoryDto = z.infer<typeof CategoryDto>;
export const CategoryListDto = z.array(CategoryDto);
