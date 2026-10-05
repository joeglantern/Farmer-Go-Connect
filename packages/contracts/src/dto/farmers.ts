import { z } from 'zod';
import { Unit } from '../enums.js';
import { FileUrl, IsoDateTime, NullableNumber, NullableString } from './primitives.js';

/**
 * What any signed-in user may see about a farmer: first name, farms and track record. Never a
 * phone number, exact coordinates or date of birth.
 */
export const FarmerBadge = z.enum(['youth', 'woman_led', 'organic', 'verified']);
export type FarmerBadge = z.infer<typeof FarmerBadge>;

export const PublicFarmDto = z.object({
  id: z.string(),
  name: z.string(),
  county: z.string(),
  ward: NullableString,
  isOrganic: z.boolean(),
  photoUrl: FileUrl,
});

/** GET /v1/farmers/featured items */
export const FeaturedFarmerDto = z.object({
  /** Farmer profile id (same as `farm.farmer.id` on listings). */
  id: z.string(),
  firstName: z.string(),
  avatarUrl: FileUrl,
  farmName: z.string(),
  county: z.string(),
  /** The farm photo, else the avatar, else null. */
  photoUrl: FileUrl,
  rating: NullableNumber,
  qaPassRate: z.number(),
  activeListings: z.number().int(),
  badges: z.array(FarmerBadge),
});
export type FeaturedFarmerDto = z.infer<typeof FeaturedFarmerDto>;
export const FeaturedFarmerListDto = z.array(FeaturedFarmerDto);

export const PublicListingDto = z.object({
  id: z.string(),
  farmId: z.string(),
  produce: z.object({ id: z.string(), name: z.string(), nameSw: z.string(), unit: Unit, imageUrl: FileUrl }),
  quantityLeft: z.number(),
  pricePerUnit: z.number().int(),
  grade: NullableString,
  availableFrom: IsoDateTime,
  availableTo: IsoDateTime,
  photoUrls: z.array(z.string()),
});

/** GET /v1/farmers/:id */
export const PublicFarmerDto = z.object({
  id: z.string(),
  firstName: z.string(),
  avatarUrl: FileUrl,
  farms: z.array(PublicFarmDto),
  rating: NullableNumber,
  ratingsCount: z.number().int(),
  ordersCompleted: z.number().int(),
  qaPassRate: z.number(),
  onTimeRate: z.number(),
  memberSince: IsoDateTime,
  badges: z.array(FarmerBadge),
  activeListings: z.array(PublicListingDto),
});
export type PublicFarmerDto = z.infer<typeof PublicFarmerDto>;
