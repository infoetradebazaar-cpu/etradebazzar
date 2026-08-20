import { db } from "../../db/index";
import {
  analyticsRegistry,
  ViewName,
} from "../../lib/analytics/analytics.registry";

type Period = "7d" | "30d" | "90d";
const MAX_LIMIT = 100;

function getPeriodDate(period: Period): Date {
  const days = { "7d": 7, "30d": 30, "90d": 90 };
  const d = new Date();
  d.setDate(d.getDate() - days[period]);
  return d;
}

function getDateFilter(period?: Period, from?: string, to?: string) {
  if (from && to) {
    return { gte: new Date(from), lte: new Date(to) };
  }
  if (period) {
    return { gte: getPeriodDate(period) };
  }
  return undefined;
}

export const analyticsService = {
  // Seller Analytics
  async getSellerOverview(sellerId: string) {
    const result = await db.$queryRaw<any[]>`
            SELECT * FROM mv_seller_order_stats
            WHERE seller_id = ${sellerId}
        `;
    return result[0] ?? null;
  },

  async getSellerDailyRevenue(
    sellerId: string,
    period?: Period,
    from?: string,
    to?: string,
  ) {
    const rows = from && to
      ? await db.$queryRaw<any[]>`
                SELECT * FROM mv_seller_daily_revenue
                WHERE seller_id = ${sellerId}
                  AND date >= ${new Date(from)}
                  AND date <= ${new Date(to)}
                ORDER BY date ASC
            `
      : await db.$queryRaw<any[]>`
            SELECT * FROM mv_seller_daily_revenue
            WHERE seller_id = ${sellerId}
              AND date >= ${period ? getPeriodDate(period) : getPeriodDate("30d")}
            ORDER BY date ASC
        `;

    return rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date,
      revenue: Number(r.gross_revenue) || 0,
      orders: Number(r.total_orders) || 0,
    }));
  },

  async getSellerTopProducts(sellerId: string, limit = 10) {
    const cappedLimit = Math.min(limit, MAX_LIMIT);
    const rows = await db.$queryRaw<any[]>`
            SELECT * FROM mv_seller_product_stats
            WHERE seller_id = ${sellerId}
            ORDER BY total_revenue DESC
            LIMIT ${cappedLimit}
        `;

    return rows.map((r) => {
      const totalRevenue = Number(r.total_revenue) || 0;
      const totalOrders = Number(r.distinct_orders) || 0;
      return {
        productId: r.product_id,
        productName: r.product_name,
        totalRevenue,
        totalOrders,
        averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      };
    });
  },

  async getSellerReturnRate(sellerId: string) {
    const [deliveredResult, returnsByStatus] = await Promise.all([
      db.$queryRaw<any[]>`
            SELECT COUNT(*)::int AS total_delivered
            FROM orders o
            WHERE o."sellerId" = ${sellerId}
              AND o.status = 'DELIVERED'
        `,
      db.$queryRaw<any[]>`
            SELECT rr.status, COUNT(*)::int AS count
            FROM return_requests rr
            JOIN orders o ON o.id = rr."orderId"
            WHERE o."sellerId" = ${sellerId}
            GROUP BY rr.status
        `,
    ]);

    const totalDelivered = Number(deliveredResult[0]?.total_delivered) || 0;
    const counts: Record<string, number> = {};
    for (const row of returnsByStatus) counts[row.status] = Number(row.count) || 0;

    const totalReturns = Object.values(counts).reduce((sum, c) => sum + c, 0);
    const pendingReturns = counts["PENDING"] ?? 0;
    const rejectedReturns = counts["REJECTED"] ?? 0;
    const approvedReturns =
      (counts["APPROVED"] ?? 0) + (counts["PICKED_UP"] ?? 0) + (counts["COMPLETED"] ?? 0);

    return {
      totalReturns,
      returnRate:
        totalDelivered > 0
          ? Math.round((totalReturns / totalDelivered) * 10000) / 100
          : 0,
      approvedReturns,
      rejectedReturns,
      pendingReturns,
    };
  },

  async getSellerAnalytics(
    sellerId: string,
    _period?: Period,
    _from?: string,
    _to?: string,
  ) {
    const [overview, returnMetrics, confirmedOrders, shippedOrders, totalProducts, activeProducts] =
      await Promise.all([
        this.getSellerOverview(sellerId),
        this.getSellerReturnRate(sellerId),
        db.order.count({ where: { sellerId, status: "CONFIRMED" } }),
        db.order.count({ where: { sellerId, status: "SHIPPED" } }),
        db.product.count({ where: { sellerId } }),
        db.product.count({ where: { sellerId, status: "LIVE" } }),
      ]);

    const totalOrders = Number(overview?.total_orders) || 0;
    const totalRevenue = Number(overview?.gross_revenue) || 0;

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      totalProducts,
      activeProducts,
      pendingOrders: Number(overview?.pending_orders) || 0,
      confirmedOrders,
      shippedOrders,
      deliveredOrders: Number(overview?.delivered_orders) || 0,
      cancelledOrders: Number(overview?.cancelled_orders) || 0,
      returnRate: returnMetrics.returnRate,
      returnCount: returnMetrics.totalReturns,
    };
  },

  // Platform Analytics

  async getPlatformOverview() {
    const result = await db.$queryRaw<any[]>`
            SELECT
                COALESCE(SUM(gmv) FILTER (WHERE status = 'APPROVED'), 0)              AS total_gmv,
                COALESCE(SUM(total_commission) FILTER (WHERE status = 'APPROVED'), 0) AS total_commission,
                COALESCE(SUM(total_orders) FILTER (WHERE status = 'APPROVED'), 0)::int AS total_orders,
                COALESCE(SUM(delivered_orders) FILTER (WHERE status = 'APPROVED'), 0)::int AS delivered_orders,
                COUNT(*)::int           AS total_sellers
            FROM mv_platform_seller_stats
        `;
    return result[0] ?? null;
  },

  async getPlatformDailyStats(period?: Period, from?: string, to?: string) {
    if (from && to) {
      return db.$queryRaw<any[]>`
                SELECT * FROM mv_platform_daily_stats
                WHERE date >= ${new Date(from)}
                  AND date <= ${new Date(to)}
                ORDER BY date ASC
            `;
    }

    const since = period ? getPeriodDate(period) : getPeriodDate("30d");
    return db.$queryRaw<any[]>`
            SELECT * FROM mv_platform_daily_stats
            WHERE date >= ${since}
            ORDER BY date ASC
        `;
  },

  async getTopSellers(limit = 10) {
    const cappedLimit = Math.min(limit, MAX_LIMIT);
    const rows = await db.$queryRaw<any[]>`
            SELECT * FROM mv_platform_seller_stats
            WHERE status = 'APPROVED'
            ORDER BY gmv DESC
            LIMIT ${cappedLimit}
        `;
    return rows.map((r) => ({
      sellerId: r.seller_id,
      sellerName: r.seller_name,
      totalRevenue: Number(r.gmv) || 0,
      totalOrders: Number(r.total_orders) || 0,
      averageOrderValue:
        Number(r.total_orders) > 0 ? Number(r.gmv) / Number(r.total_orders) : 0,
      returnRate:
        Number(r.total_orders) > 0
          ? (Number(r.total_returns) / Number(r.total_orders)) * 100
          : 0,
    }));
  },

  async getPlatformAnalytics(period?: Period, from?: string, to?: string) {
    const [overview, dailyStats, topSellers] = await Promise.all([
      this.getPlatformOverview(),
      this.getPlatformDailyStats(period, from, to),
      this.getTopSellers(),
    ]);

    const o = overview ?? {};
    const totalSellers = Number(o.total_sellers) || 0;
    const totalOrders = Number(o.total_orders) || 0;
    const totalRevenue = Number(o.total_gmv) || 0;
    const totalCommission = Number(o.total_commission) || 0;
    const deliveredOrders = Number(o.delivered_orders) || 0;

    const [activeSellersRow, pendingSellersRow, totalProductsRow] =
      await Promise.all([
        db.seller.count({ where: { status: "APPROVED" } }),
        db.seller.count({ where: { status: "PENDING" } }),
        db.product.count(),
      ]);

    return {
      totalSellers,
      activeSellers: activeSellersRow,
      pendingSellers: pendingSellersRow,
      totalOrders,
      totalRevenue,
      totalProducts: totalProductsRow,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      dailyStats,
      topSellers,
    };
  },

  // Admin: manual refresh
  async refreshView(viewName: ViewName) {
    await analyticsRegistry.refresh(viewName);
    return { refreshed: viewName, at: new Date().toISOString() };
  },

  async refreshAllViews() {
    await analyticsRegistry.refreshAll();
    return { refreshed: "all", at: new Date().toISOString() };
  },
};
