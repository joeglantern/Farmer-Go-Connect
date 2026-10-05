-- DropIndex
DROP INDEX "input_product_name_trgm";

-- DropIndex
DROP INDEX "produce_name_sw_trgm";

-- DropIndex
DROP INDEX "produce_name_trgm";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "receiptConfirmedAt" TIMESTAMP(3);
