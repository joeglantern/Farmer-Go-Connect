import { z } from 'zod';
import { page } from '../common.js';
import { KycStatus } from '../enums.js';
import { ProduceDto, SupplyListingDto } from './models.js';
import { FileUrl, NullableNumber, NullableString } from './primitives.js';

/** Farmer track record shown to buyers. Buyers see the first name only, never contact details. */
export const ListingFarmerDto = z.object({
  id: z.string(),
  ratingAvg: NullableNumber,
  qaPassRate: z.number(),
  onTimeRate: z.number(),
  ordersCompleted: z.number().int(),
  kycStatus: KycStatus,
  user: z.object({ name: z.string() }),
});

export const ListingFarmDto = z.object({
  id: z.string(),
  name: z.string(),
  county: z.string(),
  ward: NullableString,
  isOrganic: z.boolean(),
  photoUrl: FileUrl,
  farmer: ListingFarmerDto,
});

/** GET /v1/supply items and GET /v1/supply/:id */
export const ListingDto = SupplyListingDto.extend({
  produce: ProduceDto,
  farm: ListingFarmDto,
  /** Kilometres from the buyer (see GET /v1/supply `sort=nearest`); absent or null when unknown. */
  distanceKm: NullableNumber.optional(),
});
export type ListingDto = z.infer<typeof ListingDto>;

export const ListingPageDto = page(ListingDto);

export const ListingTag = z.enum(['fresh', 'organic', 'local']);

/** GET /v1/supply/:id: the listing plus what helps a buyer decide. */
export const ListingDetailDto = ListingDto.extend({
  /** Up to 6 other open listings of the same produce, nearest first when your location is known. */
  similar: z.array(ListingDto),
  /** The latest weekly average for this produce in your county (else any county), and how this price compares. */
  priceIndex: z
    .object({
      county: z.string(),
      week: z.string(),
      avgPrice: z.number().int(),
      /** (this price - average) / average, in percent to one decimal; negative is cheaper. */
      diffPct: z.number(),
    })
    .nullable(),
  /** fresh: harvested in the last 3 days or ready within 7; organic: organic farm; local: within 30 km. */
  tags: z.array(ListingTag),
});
export type ListingDetailDto = z.infer<typeof ListingDetailDto>;
export type ListingPageDto = z.infer<typeof ListingPageDto>;

/** POST and PATCH /v1/supply: the farmer's own listing. */
export const OwnListingDto = SupplyListingDto.extend({ produce: ProduceDto });
export type OwnListingDto = z.infer<typeof OwnListingDto>;

/** POST /v1/supply/:id/harvest-ready */
export const HarvestReadyDto = z.object({
  listing: SupplyListingDto,
  /** Confirmed orders on this listing that moved to READY_FOR_QA. */
  ordersReady: z.number().int(),
});
export type HarvestReadyDto = z.infer<typeof HarvestReadyDto>;
