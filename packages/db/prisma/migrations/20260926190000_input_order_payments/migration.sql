-- QA-024: green-input orders are paid by M-Pesa, held, refunded or paid out to the supplier; disputes and payouts cover them.
-- DropForeignKey
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_orderId_fkey";

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "inputOrderId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InputOrder" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "receiptConfirmedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "inputOrderId" TEXT;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "inputOrderId" TEXT,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "InputOrder_status_dispatchedAt_idx" ON "InputOrder"("status", "dispatchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_inputOrderId_key" ON "Payout"("inputOrderId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_inputOrderId_fkey" FOREIGN KEY ("inputOrderId") REFERENCES "InputOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_inputOrderId_fkey" FOREIGN KEY ("inputOrderId") REFERENCES "InputOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_inputOrderId_fkey" FOREIGN KEY ("inputOrderId") REFERENCES "InputOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

