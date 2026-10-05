-- B07: server cart, multi-farmer checkouts with one payment, delivery windows on orders.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "checkoutId" TEXT,
ADD COLUMN     "deliveryWindow" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "allocatedFromId" TEXT,
ADD COLUMN     "checkoutId" TEXT;

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "deliveryWindow" TEXT,
    "deliveryAddress" TEXT,
    "deliveryLat" DOUBLE PRECISION,
    "deliveryLng" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Checkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL,
    "buyerOrgId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Checkout_buyerOrgId_createdAt_idx" ON "Checkout"("buyerOrgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_buyerOrgId_listingId_key" ON "CartItem"("buyerOrgId", "listingId");

-- CreateIndex
CREATE INDEX "Order_checkoutId_idx" ON "Order"("checkoutId");

-- CreateIndex
CREATE INDEX "Payment_checkoutId_idx" ON "Payment"("checkoutId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkout" ADD CONSTRAINT "Checkout_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_buyerOrgId_fkey" FOREIGN KEY ("buyerOrgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "SupplyListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
