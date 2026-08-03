-- CreateEnum
CREATE TYPE "AttributeOptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- CreateTable
CREATE TABLE "category_attribute_options" (
    "id" TEXT NOT NULL,
    "categoryAttributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "metadata" JSONB,
    "status" "AttributeOptionStatus" NOT NULL DEFAULT 'APPROVED',
    "createdBySellerId" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_attribute_options_pkey" PRIMARY KEY ("id")
);

-- Backfill: existing admin-authored options become canonical, approved values
INSERT INTO "category_attribute_options" ("id", "categoryAttributeId", "value", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", unnest("options"), 'APPROVED', now(), now()
FROM "category_attributes"
WHERE "options" IS NOT NULL AND array_length("options", 1) > 0;

-- AlterTable
ALTER TABLE "category_attributes" DROP COLUMN "options";

-- CreateIndex
CREATE UNIQUE INDEX "category_attribute_options_categoryAttributeId_value_key" ON "category_attribute_options"("categoryAttributeId", "value");

-- CreateIndex
CREATE INDEX "category_attribute_options_categoryAttributeId_status_idx" ON "category_attribute_options"("categoryAttributeId", "status");

-- AddForeignKey
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_categoryAttributeId_fkey" FOREIGN KEY ("categoryAttributeId") REFERENCES "category_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_createdBySellerId_fkey" FOREIGN KEY ("createdBySellerId") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attribute_options" ADD CONSTRAINT "category_attribute_options_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "category_attribute_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
