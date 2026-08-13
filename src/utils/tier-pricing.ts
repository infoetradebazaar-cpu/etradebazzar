import { db } from "../db/index";

const MAX_TIER_EXTRAPOLATION_MULTIPLIER = 2;

export type TierZone = "base" | "tiered" | "beyond";

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

  const topTier = tiers[tiers.length - 1]!;
  if (qty > topTier.minQty * MAX_TIER_EXTRAPOLATION_MULTIPLIER) {
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: null, zone: "beyond", tierId: null };
  }

  // Highest minQty tier that's still <= qty - same "applicable tier" lookup
  let applicable = null as (typeof tiers)[number] | null;
  for (const tier of tiers) {
    if (tier.minQty <= qty) applicable = tier;
    else break;
  }

  if (!applicable) {
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: null, zone: "base", tierId: null };
  }

  return {
    visiblePrice: Number(applicable.price),
    hiddenFloorPrice: applicable.hiddenFloorPrice !== null ? Number(applicable.hiddenFloorPrice) : null,
    zone: "tiered",
    tierId: applicable.id,
  };
}
