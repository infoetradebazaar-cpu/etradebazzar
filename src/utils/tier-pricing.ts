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

  // Highest minQty tier that's still <= qty
  let applicableIndex = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (tiers[i]!.minQty <= qty) applicableIndex = i;
    else break;
  }

  if (applicableIndex === -1) {
    // Qty below first tier — use SKU price as visible, first tier price as hidden floor
    const firstTier = tiers[0]!;
    const hiddenFloor = firstTier.hiddenFloorPrice !== null
      ? Number(firstTier.hiddenFloorPrice)
      : Number(firstTier.price);
    return { visiblePrice: Number(sku.price), hiddenFloorPrice: hiddenFloor, zone: "base", tierId: null };
  }

  const applicable = tiers[applicableIndex]!;

  // Use explicit hiddenFloorPrice if set, otherwise derive from next tier's price
  let hiddenFloorPrice = applicable.hiddenFloorPrice !== null
    ? Number(applicable.hiddenFloorPrice)
    : null;

  if (hiddenFloorPrice === null && applicableIndex < tiers.length - 1) {
    const nextTier = tiers[applicableIndex + 1]!;
    hiddenFloorPrice = Number(nextTier.price);
  }

  // For the last tier with no explicit hidden floor, use 97% of the visible price
  if (hiddenFloorPrice === null) {
    hiddenFloorPrice = Math.round(Number(applicable.price) * 0.97 * 100) / 100;
  }

  return {
    visiblePrice: Number(applicable.price),
    hiddenFloorPrice,
    zone: "tiered",
    tierId: applicable.id,
  };
}
