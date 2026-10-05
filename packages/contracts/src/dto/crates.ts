import { z } from 'zod';
import { page } from '../common.js';
import { CrateDto, CrateMovementDto } from './models.js';

/** POST /v1/crates (201) */
export const CratesCreatedDto = z.object({ created: z.number().int(), qrCodes: z.array(z.string()) });
export type CratesCreatedDto = z.infer<typeof CratesCreatedDto>;

/** GET /v1/crates */
export const CratePageDto = page(CrateDto).extend({
  /** Count of crates per status across the whole fleet. */
  summary: z.record(z.string(), z.number().int()),
});
export type CratePageDto = z.infer<typeof CratePageDto>;

/** GET /v1/crates/:qrCode */
export const CrateDetailDto = CrateDto.extend({
  movements: z.array(CrateMovementDto.extend({ scannedBy: z.object({ name: z.string() }) })),
});
export type CrateDetailDto = z.infer<typeof CrateDetailDto>;
