import { db } from "../db/index";

const MAX_TIER_EXTRAPOLATION_MULTIPLIER = 2;

export type TierZone = "base" | "tiered" | "gap" | "beyond";

export interface TierResolution {
  visiblePrice: number;
  hiddenFloorPrice: number | null;
  zone: TierZone;
  tierId: string | null;
}

export async function resolveTierPrice(skuId: string, qty: number): Promise<TierResolution> {
  const sku = await db.productSKU.findUnique({ where: { id: skuId } });
  if (!sku) throw new Error("SKU not found");

  const tiers = await db.skuPriceTier.findMany({
    where: { skuId },
    orderBy: { minQty: "asc" },
  });

  if (tiers.length === 0) {
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: null, zone: "base", tierId: null };
  }

  if (qty < tiers[0]!.minQty) {
    const firstTier = tiers[0]!;
    const hiddenFloor = firstTier.hiddenFloorPrice !== null
      ? Number(firstTier.hiddenFloorPrice)
      : Number(firstTier.price);
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: hiddenFloor, zone: "base", tierId: null };
  }

  const topTier = tiers[tiers.length - 1]!;
  if (topTier.maxQty === null && qty > topTier.minQty * MAX_TIER_EXTRAPOLATION_MULTIPLIER) {
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: null, zone: "beyond", tierId: null };
  }

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const nextTier = tiers[i + 1];
    const effectiveMax =
      tier.maxQty !== null ? tier.maxQty :
      nextTier ? nextTier.minQty - 1 :
      Infinity;

    if (qty >= tier.minQty && qty <= effectiveMax) {
      let hiddenFloorPrice = tier.hiddenFloorPrice !== null
        ? Number(tier.hiddenFloorPrice)
        : null;

      if (hiddenFloorPrice === null && nextTier) {
        hiddenFloorPrice = Number(nextTier.price);
      }

      if (hiddenFloorPrice === null) {
        hiddenFloorPrice = Math.round(Number(tier.price) * 0.97 * 100) / 100;
      }

      return {
        visiblePrice: Number(tier.price),
        hiddenFloorPrice,
        zone: "tiered",
        tierId: tier.id,
      };
    }
  }

  return { visiblePrice: Number(sku.price), hiddenFloorPrice: null, zone: "gap", tierId: null };
}
