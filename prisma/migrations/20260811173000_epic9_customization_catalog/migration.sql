-- CreateEnum
CREATE TYPE "CustomizationOptionType" AS ENUM ('TEXT', 'NUMBER', 'COLOR', 'SELECT', 'IMAGE_UPLOAD');

-- CreateTable
CREATE TABLE "customization_option_groups" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customization_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customization_options" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomizationOptionType" NOT NULL,
    "priceDelta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customization_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customization_option_groups_productId_name_key" ON "customization_option_groups"("productId", "name");
CREATE INDEX "customization_option_groups_productId_idx" ON "customization_option_groups"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "customization_options_groupId_label_key" ON "customization_options"("groupId", "label");
CREATE INDEX "customization_options_groupId_idx" ON "customization_options"("groupId");

-- AddForeignKey
ALTER TABLE "customization_option_groups" ADD CONSTRAINT "customization_option_groups_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customization_options" ADD CONSTRAINT "customization_options_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "customization_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
