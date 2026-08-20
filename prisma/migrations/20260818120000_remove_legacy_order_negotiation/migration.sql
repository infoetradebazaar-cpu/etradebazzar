-- Remove legacy order-embedded negotiation system

-- DropForeignKey (order_negotiations -> orders)
ALTER TABLE IF EXISTS "order_negotiations" DROP CONSTRAINT IF EXISTS "order_negotiations_orderId_fkey";

-- DropTable
DROP TABLE IF EXISTS "order_negotiations";

-- DropForeignKey (order_thresholds -> sellers)
ALTER TABLE IF EXISTS "order_thresholds" DROP CONSTRAINT IF EXISTS "order_thresholds_sellerId_fkey";

-- DropTable
DROP TABLE IF EXISTS "order_thresholds";

-- Migrate any orders left in the dead NEGOTIATING status before dropping the enum value.
UPDATE "orders" SET "status" = 'PENDING_ASSIGNMENT' WHERE "status" = 'NEGOTIATING';

-- BaseView.create()).
DROP MATERIALIZED VIEW IF EXISTS "mv_seller_order_stats";
DROP MATERIALIZED VIEW IF EXISTS "mv_seller_daily_revenue";
DROP MATERIALIZED VIEW IF EXISTS "mv_platform_seller_stats";
DROP MATERIALIZED VIEW IF EXISTS "mv_platform_daily_stats";
DROP MATERIALIZED VIEW IF EXISTS "mv_seller_product_stats";

-- Remove NEGOTIATING from the OrderStatus enum (Postgres requires recreating the type).
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "status" TYPE TEXT;
DROP TYPE IF EXISTS "OrderStatus";
CREATE TYPE "OrderStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'PACKED',
    'PROCESSING',
    'SHIPPED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
    'PENDING_ASSIGNMENT',
    'UNFULFILLABLE',
    'RETURNED'
);
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus");
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateMaterializedView: mv_seller_order_stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_seller_order_stats AS
SELECT
    o."sellerId"                                                AS seller_id,
    COUNT(*)::int                                               AS total_orders,
    COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int        AS delivered_orders,
    COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int        AS cancelled_orders,
    COUNT(*) FILTER (WHERE o.status = 'PENDING')::int          AS pending_orders,
    COUNT(*) FILTER (WHERE o.status = 'PROCESSING')::int       AS processing_orders,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") ELSE 0 END
    ), 0)                                                       AS gross_revenue,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."commissionAmount", 0) ELSE 0 END
    ), 0)                                                       AS total_commission,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") - COALESCE(o."commissionAmount", 0)
        ELSE 0 END
    ), 0)                                                       AS net_revenue,
    COUNT(*) FILTER (WHERE o.type = 'HIGH_TICKET')::int        AS high_ticket_orders,
    COUNT(*) FILTER (WHERE o.type = 'BULK')::int               AS bulk_orders,
    COUNT(*) FILTER (WHERE o.type = 'SAMPLE')::int             AS sample_orders,
    MIN(o."createdAt")                                          AS first_order_at,
    MAX(o."createdAt")                                          AS last_order_at
FROM orders o
GROUP BY o."sellerId"
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_seller_order_stats_seller
 ON mv_seller_order_stats (seller_id);

-- CreateMaterializedView: mv_seller_daily_revenue
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_seller_daily_revenue AS
SELECT
    o."sellerId"                                                AS seller_id,
    DATE(o."createdAt")                                         AS date,
    COUNT(*)::int                                               AS total_orders,
    COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int        AS delivered_orders,
    COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int        AS cancelled_orders,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") ELSE 0 END
    ), 0)                                                       AS gross_revenue,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."commissionAmount", 0) ELSE 0 END
    ), 0)                                                       AS commission,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") - COALESCE(o."commissionAmount", 0)
        ELSE 0 END
    ), 0)                                                       AS net_revenue
FROM orders o
GROUP BY o."sellerId", DATE(o."createdAt")
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_seller_daily_revenue_pk
 ON mv_seller_daily_revenue (seller_id, date);
CREATE INDEX IF NOT EXISTS idx_mv_seller_daily_revenue_date
 ON mv_seller_daily_revenue (date DESC);

-- CreateMaterializedView: mv_platform_seller_stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_platform_seller_stats AS
SELECT
    s.id                                                        AS seller_id,
    s.name                                                      AS seller_name,
    s."businessName"                                            AS business_name,
    s.status,
    COUNT(DISTINCT sh.id)::int                                  AS total_shops,
    COUNT(DISTINCT p.id)::int                                   AS total_products,
    COUNT(DISTINCT o.id)::int                                   AS total_orders,
    COUNT(DISTINCT o.id) FILTER (
        WHERE o.status = 'DELIVERED'
    )::int                                                      AS delivered_orders,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") ELSE 0 END
    ), 0)                                                       AS gmv,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."commissionAmount", 0) ELSE 0 END
    ), 0)                                                       AS total_commission,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") - COALESCE(o."commissionAmount", 0)
        ELSE 0 END
    ), 0)                                                       AS net_revenue,
    COUNT(DISTINCT rr.id)::int                                  AS total_returns,
    s."createdAt"                                               AS seller_since
FROM sellers s
LEFT JOIN shops sh ON sh."sellerId" = s.id
LEFT JOIN products p ON p."sellerId" = s.id
LEFT JOIN orders o ON o."sellerId" = s.id
LEFT JOIN return_requests rr ON rr."orderId" = o.id
GROUP BY s.id, s.name, s."businessName", s.status, s."createdAt"
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_platform_seller_stats_seller
 ON mv_platform_seller_stats (seller_id);
CREATE INDEX IF NOT EXISTS idx_mv_platform_seller_stats_gmv
 ON mv_platform_seller_stats (gmv DESC);

-- CreateMaterializedView: mv_platform_daily_stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_platform_daily_stats AS
SELECT
    DATE(o."createdAt")                                         AS date,
    COUNT(*)::int                                               AS total_orders,
    COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int        AS delivered_orders,
    COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int        AS cancelled_orders,
    COUNT(DISTINCT o."sellerId")::int                           AS active_sellers,
    COUNT(DISTINCT o."customerId")::int                         AS active_customers,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."finalAmount", o."totalAmount") ELSE 0 END
    ), 0)                                                       AS gmv,
    COALESCE(SUM(
        CASE WHEN o.status = 'DELIVERED'
        THEN COALESCE(o."commissionAmount", 0) ELSE 0 END
    ), 0)                                                       AS total_commission,
    COUNT(*) FILTER (WHERE o.type = 'HIGH_TICKET')::int        AS high_ticket_orders,
    COUNT(*) FILTER (WHERE o.type = 'BULK')::int               AS bulk_orders,
    COUNT(*) FILTER (WHERE o.type = 'STANDARD')::int           AS standard_orders,
    COUNT(*) FILTER (WHERE o.type = 'SAMPLE')::int             AS sample_orders
FROM orders o
GROUP BY DATE(o."createdAt")
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_platform_daily_stats_date
 ON mv_platform_daily_stats (date);

-- CreateMaterializedView: mv_seller_product_stats
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_seller_product_stats AS
SELECT
    p."sellerId"                                                AS seller_id,
    p.id                                                        AS product_id,
    p.name                                                      AS product_name,
    p."categoryId"                                              AS category_id,
    COUNT(oi.id)::int                                           AS total_order_items,
    COALESCE(SUM(oi.quantity), 0)::int                         AS total_units_sold,
    COALESCE(SUM(
        COALESCE(oi."finalUnitPrice", oi."unitPrice") * oi.quantity
    ), 0)                                                       AS total_revenue,
    COALESCE(AVG(
        COALESCE(oi."finalUnitPrice", oi."unitPrice")
    ), 0)                                                       AS avg_unit_price,
    COUNT(DISTINCT oi."orderId")::int                           AS distinct_orders
FROM products p
LEFT JOIN order_items oi ON oi."productId" = p.id
LEFT JOIN orders o ON o.id = oi."orderId" AND o.status = 'DELIVERED'
GROUP BY p."sellerId", p.id, p.name, p."categoryId"
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_seller_product_stats_pk
 ON mv_seller_product_stats (seller_id, product_id);
CREATE INDEX IF NOT EXISTS idx_mv_seller_product_stats_revenue
 ON mv_seller_product_stats (seller_id, total_revenue DESC);
