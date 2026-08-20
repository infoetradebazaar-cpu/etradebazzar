import { getCommissionRate } from "../../utils/commission";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { slaConfigService } from "../platform/sla-config.service";
import { recommendationService } from "../../lib/order-assignment/recommendation.service";
import { InsufficientStockError } from "../../lib/inventory/stock.errors";

export { InsufficientStockError };

export interface DeliveryAddress {
  receiverName: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

interface NegotiationLike {
  id: string;
  sellerId: string;
  customerId: string;
  orgId?: string | null;
  productId: string;
  skuId: string;
  quantity: number;
}

export async function createOrderFromNegotiation(
  tx: any,
  session: NegotiationLike,
  finalPrice: number,
  address: DeliveryAddress,
) {
  const product = await tx.product.findUnique({
    where: { id: session.productId },
    include: { category: { select: { name: true } } },
  });
  if (!product) throw new Error("Product not found");
  const skuStockUpdate = await tx.productSKU.updateMany({
    where: { id: session.skuId, stock: { gte: session.quantity } },
    data: { stock: { decrement: session.quantity } },
  });
  if (skuStockUpdate.count === 0) {
    throw new InsufficientStockError(`Insufficient stock for product: ${product.name}`);
  }

  const commissionRate = await getCommissionRate(session.productId, product.category.name);
  const commissionAmount = (finalPrice * commissionRate) / 100;
  const displayId = await generateDisplayId("order");
  let status: "CONFIRMED" | "PENDING_ASSIGNMENT" = "PENDING_ASSIGNMENT";
  let autoAssignedShopId: string | null = null;
  const trusted = await recommendationService.hasTrustedShops(session.sellerId);
  if (trusted) {
    const recs = await recommendationService.computeRecommendations(
      session.sellerId,
      [{ productId: session.productId, quantity: session.quantity }],
      address.latitude,
      address.longitude,
    );
    const topPick = recs[0];
    if (topPick?.autoAssignEnabled && topPick.stockScore >= 80) {
      status = "CONFIRMED";
      autoAssignedShopId = topPick.shopId;
    }
  }

  const packingSla = status === "CONFIRMED" ? await slaConfigService.getSlaConfig() : null;
  const packingDeadline = packingSla?.packing_sla_hours
    ? new Date(Date.now() + packingSla.packing_sla_hours * 60 * 60 * 1000)
    : undefined;

  return tx.order.create({
    data: {
      displayId,
      sellerId: session.sellerId,
      customerId: session.customerId,
      orgId: session.orgId ?? null,
      type: "STANDARD",
      status,
      totalAmount: finalPrice,
      finalAmount: finalPrice,
      commissionRate,
      commissionAmount,
      assignedShopId: autoAssignedShopId,
      packingDeadline,
      items: {
        create: {
          productId: session.productId,
          skuId: session.skuId,
          quantity: session.quantity,
          unitPrice: finalPrice / session.quantity,
          finalUnitPrice: finalPrice / session.quantity,
        },
      },
      addresses: {
        create: {
          ...address,
          assignedShopId: autoAssignedShopId,
          fulfillmentStatus: autoAssignedShopId ? "ASSIGNED" : "PENDING",
        },
      },
    },
  });
}
