-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "sellerApprovedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedByType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "disclaimerText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotationNumber_key" ON "quotations"("quotationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_orderId_key" ON "quotations"("orderId");

-- CreateIndex
CREATE INDEX "quotations_sellerId_idx" ON "quotations"("sellerId");

-- CreateIndex
CREATE INDEX "quotations_buyerId_idx" ON "quotations"("buyerId");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


--  20260907140000_proforma_invoice 
-- CreateTable
CREATE TABLE "proforma_invoices" (
    "id" TEXT NOT NULL,
    "piNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedByType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proforma_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proforma_invoices_piNumber_key" ON "proforma_invoices"("piNumber");

-- CreateIndex
CREATE UNIQUE INDEX "proforma_invoices_orderId_key" ON "proforma_invoices"("orderId");

-- CreateIndex
CREATE INDEX "proforma_invoices_sellerId_idx" ON "proforma_invoices"("sellerId");

-- CreateIndex
CREATE INDEX "proforma_invoices_buyerId_idx" ON "proforma_invoices"("buyerId");

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "NotificationDeliveryChannel" AS ENUM ('EMAIL', 'SMS', 'SSE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'RETRYING', 'EXHAUSTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'ACCOUNT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REVIEW_RECEIVED';

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_shopId_fkey";

-- AlterTable
ALTER TABLE "customer_orgs" ADD COLUMN IF NOT EXISTS "annualTurnover" TEXT,
ADD COLUMN IF NOT EXISTS "businessType" TEXT,
ADD COLUMN IF NOT EXISTS "employees" TEXT,
ADD COLUMN IF NOT EXISTS "gstVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "gstVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "gstin" TEXT,
ADD COLUMN IF NOT EXISTS "industry" TEXT,
ADD COLUMN IF NOT EXISTS "legalEntityName" TEXT,
ADD COLUMN IF NOT EXISTS "pan" TEXT,
ADD COLUMN IF NOT EXISTS "panVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "panVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "registeredEmail" TEXT,
ADD COLUMN IF NOT EXISTS "tradeName" TEXT,
ADD COLUMN IF NOT EXISTS "website" TEXT,
ADD COLUMN IF NOT EXISTS "yearEstablished" INTEGER;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN IF NOT EXISTS "skuId" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN IF EXISTS "shopId";

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "twoFactorMethod" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedByType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedByType" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" "NotificationDeliveryChannel" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_templates" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_orderId_key" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_sellerId_idx" ON "invoices"("sellerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_buyerId_idx" ON "invoices"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_orderId_key" ON "purchase_orders"("orderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_orders_sellerId_idx" ON "purchase_orders"("sellerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "purchase_orders_buyerId_idx" ON "purchase_orders"("buyerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_nextRetryAt_idx" ON "notification_deliveries"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "notification_templates_type_key" ON "notification_templates"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "product_images_skuId_idx" ON "product_images"("skuId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "product_images" ADD CONSTRAINT "product_images_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



--  20261103160000_shipment_tracking_id_index 
-- Shipment webhooks look shipments up by trackingId (AWB); without this every event scans the table.
CREATE INDEX IF NOT EXISTS "shipments_trackingId_idx" ON "shipments"("trackingId");


--  20261103170000_order_idempotency_key 
-- Durable copy of the order idempotency key, so a Redis flush can't let a retried
-- checkout create a second order. NULL for orders created before this column.
ALTER TABLE "orders" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");


DROP INDEX IF EXISTS "orders_customerId_idx";
DROP INDEX IF EXISTS "orders_orgId_idx";
CREATE INDEX "orders_sellerId_createdAt_idx" ON "orders"("sellerId", "createdAt");
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");
CREATE INDEX "orders_orgId_createdAt_idx" ON "orders"("orgId", "createdAt");
-- Shop-access filter on seller order lists and per-shop order counts.
CREATE INDEX "orders_assignedShopId_idx" ON "orders"("assignedShopId");
-- SLA sweeps (every 15 min): packing and dispatch deadline breaches.
CREATE INDEX "orders_status_packingDeadline_idx" ON "orders"("status", "packingDeadline");
CREATE INDEX "orders_status_dispatchDeadline_idx" ON "orders"("status", "dispatchDeadline");
-- 48-working-hour auto-refund sweep and the "awaiting approval" filter.
CREATE INDEX "orders_sellerApprovedAt_paymentStatus_idx" ON "orders"("sellerApprovedAt", "paymentStatus");

CREATE UNIQUE INDEX "wallet_transactions_walletId_reason_referenceId_key"
    ON "wallet_transactions"("walletId", "reason", "referenceId");

-- an order can belong to at most one payout. Failed payouts delete their
-- payout_orders rows, so the order can still be paid out by a later payout.
DROP INDEX IF EXISTS "payout_orders_orderId_idx";
CREATE UNIQUE INDEX "payout_orders_orderId_key" ON "payout_orders"("orderId");


--  20261103200000_search_and_export_indexes 
-- trigram (GIN) indexes so case-insensitive "contains" searches on products and
-- users use an index instead of scanning the table. Needs the pg_trgm extension.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_sku_trgm_idx" ON "products" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "products_displayId_trgm_idx" ON "products" USING GIN ("displayId" gin_trgm_ops);
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);

-- the shipment CSV export pages through all shipments newest-first.
CREATE INDEX "shipments_createdAt_idx" ON "shipments"("createdAt");


-- Pre-negotiation requirements form + per-session credit fee
ALTER TABLE "negotiation_sessions" ADD COLUMN "intent" JSONB;
ALTER TABLE "negotiation_sessions" ADD COLUMN "creditsCharged" INTEGER NOT NULL DEFAULT 0;


-- Template-based negotiation offers
ALTER TABLE "negotiation_messages" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "negotiation_messages" ADD COLUMN "offer" JSONB;

-- Seller negotiation strikes (flagged for admin review at 3)
ALTER TABLE "sellers" ADD COLUMN "negotiationFlagCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sellers" ADD COLUMN "negotiationFlaggedAt" TIMESTAMP(3);

