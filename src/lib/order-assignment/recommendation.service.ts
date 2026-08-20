import { db } from "../../db";
import { redis } from "../../db/redis";
import { haversineDistance } from "../../utils/geo";

const WEIGHTS = { priority: 0.30, distance: 0.25, stock: 0.25, reliablity: 0.20 };

const CAHCE_TTL_SECONDS = 30;

interface OrderedItem {
    productId: string;
    skuId?: string;
    quantity: number;
}

function normalizeOptions(options: unknown): string {
    const obj = (options ?? {}) as Record<string, string>;
    return JSON.stringify(
        Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))),
    );
}

export interface ShopRecommendation {
    shopId: string;
    shopName: string;
    confidence: number;
    distanceKm: number | null;
    stockScore: number;
    autoAssignEnabled: boolean;
}

export const recommendationService = {
    async getCandidateShops(sellerId: string, items: OrderedItem[]) {
        const orderedProducts = await db.product.findMany({
            where: { id: { in: items.map((i) => i.productId) } },
            select: {
                id: true, sku: true, name: true, categoryId: true, shopId: true, stock: true,
                skus: { select: { id: true, options: true, stock: true } },
            },
        });

        const shops = await db.shop.findMany({
            where: { sellerId, status: "APPROVED" },
            select: { id: true, name: true, priority: true, reliabilityScore: true, latitude: true, longitude: true, autoAssignEnabled: true },
        });

        const candidates = [];

        for (const shop of shops) {
            const stockRatios: number[] = [];
            let fulfillable = true;

            for (const item of items) {
                const orderedProduct = orderedProducts.find((p) => p.id === item.productId)!;
                const orderedSku = item.skuId
                    ? orderedProduct.skus.find((s) => s.id === item.skuId)
                    : undefined;

                let stock: number | null = null;

                if (orderedProduct.shopId === shop.id) {
                    stock = orderedSku ? orderedSku.stock ?? 0 : orderedProduct.stock ?? 0;
                } else {
                    const sibling = await db.product.findFirst({
                        where: {
                            shopId: shop.id,
                            status: "LIVE",
                            OR: [
                                ...(orderedProduct.sku ? [{ sku: orderedProduct.sku }] : []),
                                { name: orderedProduct.name, categoryId: orderedProduct.categoryId },
                            ],
                        },
                        select: {
                            stock: true,
                            skus: { select: { options: true, stock: true } },
                        },
                    });
                    if (sibling) {
                        if (orderedSku) {
                            const match = sibling.skus.find(
                                (s) => normalizeOptions(s.options) === normalizeOptions(orderedSku.options),
                            );
                            stock = match ? match.stock ?? 0 : 0;
                        } else {
                            stock = sibling.stock ?? 0;
                        }
                    }
                }

                if (stock === null) { fulfillable = false; break; }

                stockRatios.push(Math.min(1, stock / item.quantity));
            }

            if (!fulfillable) continue;

            const avgStockRatio = stockRatios.reduce((a, b) => a + b, 0) / stockRatios.length;
            candidates.push({ shop, avgStockRatio });
        }

        return candidates;
    },

    async computeRecommendations(
        sellerId: string,
        items: OrderedItem[],
        deliveryLat?: number,
        deliveryLng?: number
    ): Promise<ShopRecommendation[]> {
        const candidates = await this.getCandidateShops(sellerId, items);
        if (!candidates.length) return [];

        const maxPriority = Math.max(...candidates.map((c) => c.shop.priority), 1);

        const scored = candidates.map(({ shop, avgStockRatio }) => {
            const priorityScore = 1 - (shop.priority - 1) / maxPriority;

            let distanceKm: number | null = null;
            let distanceScore = 0.5;
            if (deliveryLat && deliveryLng && shop.latitude && shop.longitude) {
                distanceKm = haversineDistance(deliveryLat, deliveryLng, Number(shop.latitude), Number(shop.longitude));
                distanceScore = Math.max(0, 1 - distanceKm / 1500);
            }

            const stockScore = avgStockRatio;
            const reliabilityScore = Number(shop.reliabilityScore) / 100;

            const confidence =
                (WEIGHTS.priority * priorityScore +
                    WEIGHTS.distance * distanceScore +
                    WEIGHTS.stock * stockScore +
                    WEIGHTS.reliablity * reliabilityScore) * 100;

            return {
                shopId: shop.id,
                shopName: shop.name,
                confidence: Math.round(confidence * 100) / 100,
                distanceKm: distanceKm ? Math.round(distanceKm * 10) / 10 : null,
                stockScore: Math.round(stockScore * 10000) / 100,
                autoAssignEnabled: shop.autoAssignEnabled,
            };
        });

        return scored.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    },

    async hasTrustedShops(sellerId: string): Promise<boolean> {
        const count = await db.shop.count({ where: { sellerId, status: "APPROVED", autoAssignEnabled: true } });
        return count > 0;
    },

    async getRecommendationsCached(
        orderId: string,
        sellerId: string,
        items: OrderedItem[],
        deliveryLat?: number,
        deliveryLng?: number
    ): Promise<ShopRecommendation[]> {
        const cacheKey = `shop-rec:${orderId}`;

        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch {
        }

        const fresh = await this.computeRecommendations(sellerId, items, deliveryLat, deliveryLng);

        redis.setex(cacheKey, CAHCE_TTL_SECONDS, JSON.stringify(fresh)).catch(() => null);

        return fresh;
    },
};