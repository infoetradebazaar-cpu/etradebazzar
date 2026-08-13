import { getCommissionRate } from "../../utils/commission";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { slaConfigService } from "../platform/sla-config.service";

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

  const commissionRate = await getCommissionRate(session.productId, product.category.name);
  const commissionAmount = (finalPrice * commissionRate) / 100;
  const displayId = await generateDisplayId("order");
  const { packing_sla_hours } = await slaConfigService.getSlaConfig();

  return tx.order.create({
    data: {
      displayId,
      sellerId: session.sellerId,
      customerId: session.customerId,
      type: "STANDARD",
      status: "CONFIRMED",
      totalAmount: finalPrice,
      finalAmount: finalPrice,
      commissionRate,
      commissionAmount,
      packingDeadline: packing_sla_hours
        ? new Date(Date.now() + packing_sla_hours * 60 * 60 * 1000)
        : undefined,
      items: {
        create: {
          productId: session.productId,
          skuId: session.skuId,
          quantity: session.quantity,
          unitPrice: finalPrice / session.quantity,
          finalUnitPrice: finalPrice / session.quantity,
        },
      },
      addresses: { create: address },
    },
  });
}
