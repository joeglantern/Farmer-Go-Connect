-- New listings wait for a QA check at the farm before buyers can see them.
-- AlterEnum (the new values are not used in this migration, so ADD VALUE is safe here)
ALTER TYPE "ListingStatus" ADD VALUE 'PENDING_QA';
ALTER TYPE "ListingStatus" ADD VALUE 'QA_REJECTED';

-- AlterTable
ALTER TABLE "SupplyListing" ADD COLUMN "qaApprovedAt" TIMESTAMP(3),
ADD COLUMN "qaCheckedById" TEXT,
ADD COLUMN "qaNote" TEXT,
ADD COLUMN "qaPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Every listing that exists today is grandfathered in as approved.
UPDATE "SupplyListing" SET "qaApprovedAt" = "createdAt";

-- Proof of delivery by SMS code, for recipients who cannot sign.
-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN "deliveryCodeHash" TEXT,
ADD COLUMN "deliveryCodeSentAt" TIMESTAMP(3),
ADD COLUMN "deliveryCodeAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "codeConfirmedAt" TIMESTAMP(3);
