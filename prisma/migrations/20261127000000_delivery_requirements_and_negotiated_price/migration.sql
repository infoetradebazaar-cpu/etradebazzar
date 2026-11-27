-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "negotiatedExpiresAt" TIMESTAMP(3),
ADD COLUMN     "negotiatedPrice" DECIMAL(10,2),
ADD COLUMN     "negotiationId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "addressSheetUrl" TEXT,
ADD COLUMN     "customerNotes" TEXT,
ADD COLUMN     "multiLocation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "negotiationIntent" JSONB,
ADD COLUMN     "requiredBy" TIMESTAMP(3);
