-- B11: per-user read receipts for order chat threads.
-- CreateTable
CREATE TABLE "ConversationRead" (
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRead_pkey" PRIMARY KEY ("orderId","userId")
);

-- CreateIndex
CREATE INDEX "ConversationRead_userId_idx" ON "ConversationRead"("userId");

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRead" ADD CONSTRAINT "ConversationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

