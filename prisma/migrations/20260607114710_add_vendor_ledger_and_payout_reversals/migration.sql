-- CreateEnum
CREATE TYPE "VendorLedgerEntryType" AS ENUM ('PAYOUT_HOLD', 'PAYOUT_RELEASE', 'PAYOUT_PAID', 'REFUND_REVERSAL', 'VENDOR_DEBIT', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'REVERSED';

-- CreateTable
CREATE TABLE "VendorLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "VendorLedgerEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutReversal" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutReversal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorLedgerEntry_vendorId_idx" ON "VendorLedgerEntry"("vendorId");

-- CreateIndex
CREATE INDEX "VendorLedgerEntry_referenceType_referenceId_idx" ON "VendorLedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "PayoutReversal_payoutId_idx" ON "PayoutReversal"("payoutId");

-- CreateIndex
CREATE INDEX "PayoutReversal_vendorId_idx" ON "PayoutReversal"("vendorId");

-- CreateIndex
CREATE INDEX "PayoutReversal_orderId_idx" ON "PayoutReversal"("orderId");

-- AddForeignKey
ALTER TABLE "VendorLedgerEntry" ADD CONSTRAINT "VendorLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReversal" ADD CONSTRAINT "PayoutReversal_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "VendorPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReversal" ADD CONSTRAINT "PayoutReversal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutReversal" ADD CONSTRAINT "PayoutReversal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
