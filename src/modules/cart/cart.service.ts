import { getPlatformConfigNumber } from "../../lib/platform-config/platform-config";

import { db } from "../../db/index";
import { orderService } from "../order/order.service";
import { couponService } from "../coupon/coupon.service";
import { shipmentService } from "../shipment/shipment.service";
import { withCustomerOrgScope } from "../../middleware/tenant";
import type { Prisma } from "../../../prisma/generated/client";

export const COD_DEFAULT_MAX_ORDER_VALUE = 50000;

type OrgId = string | null | undefined;

function cartScope<T>(
  orgId: OrgId,
  fn: (client: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return orgId ? withCustomerOrgScope(orgId, fn) : fn(db);
}

async function getOrCreateCart(userId: string, orgId: OrgId) {
  const where = orgId ? { orgId } : { userId, orgId: null };

  let cart = await cartScope(orgId, (client) => client.cart.findFirst({ where }));
  if (!cart) {
    try {
      cart = await cartScope(orgId, (client) =>
        client.cart.create({ data: { userId, orgId: orgId ?? null } }),
      );
    } catch (err: any) {
      if (err.code === "P2002") {
        cart = await cartScope(orgId, (client) => client.cart.findFirstOrThrow({ where }));
      } else {
        throw err;
      }
    }
  }
  return cart;
}

async function getCartWithItems(userId: string, orgId: OrgId) {
  const cart = await getOrCreateCart(userId, orgId);

  // Drop negotiated-price items whose lock has expired (5 days from add)
  await db.cartItem.deleteMany({
    where: { cartId: cart.id, negotiatedExpiresAt: { lt: new Date() } },
  });

  const items = await db.cartItem.findMany({
    where: { cartId: cart.id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          stock: true,
          sellerId: true,
          weightGrams: true,
          images: { take: 1, orderBy: { order: "asc" } },
        },
      },
      sku: {
        select: {
          id: true,
          sku: true,
          price: true,
          stock: true,
          options: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let subtotal = 0;
  const lineItems = items.map((item) => {
    const unitPrice = Number(
      item.negotiatedPrice ?? item.sku?.price ?? item.product.price ?? 0,
    );
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    return {
      id: item.id,
      productId: item.productId,
      skuId: item.skuId,
      productName: item.product.name,
      image: item.product.images[0]?.url,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      availableStock: item.sku?.stock ?? item.product.stock ?? 0,
      options: item.sku?.options,
      weightGrams: item.product.weightGrams ?? 500,
      negotiationId: item.negotiationId,
      negotiatedPrice: item.negotiatedPrice ? Number(item.negotiatedPrice) : null,
      negotiatedExpiresAt: item.negotiatedExpiresAt,
      listPrice: Number(item.sku?.price ?? item.product.price ?? 0),
    };
  });

  return { cart, items: lineItems, subtotal, sellerId: cart.sellerId };
}

export const cartService = {
  async getCart(userId: string, orgId?: OrgId) {
    return getCartWithItems(userId, orgId);
  },

  async addItem(
    userId: string,
    data: { productId: string; skuId?: string; quantity: number; negotiationId?: string },
    orgId?: OrgId,
  ) {
    const product = await db.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) throw new Error("Product not found");
    if (product.status !== "LIVE") throw new Error("Product not available");

    // Resolve negotiated price lock (5 days) when a confirmed session is referenced
    let negotiatedPrice: number | null = null;
    let negotiatedExpiresAt: Date | null = null;
    if (data.negotiationId) {
      const session = await db.negotiationSession.findFirst({
        where: {
          id: data.negotiationId,
          customerId: userId,
          status: "ACCEPTED",
          productId: data.productId,
          skuId: data.skuId ?? undefined,
        },
      });
      if (!session) {
        throw new Error("Negotiation session not found or not confirmed");
      }
      if (session.finalPrice != null) {
        negotiatedPrice = Number(session.finalPrice);
        negotiatedExpiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      }
    }

    const cart = await getOrCreateCart(userId, orgId);

    if (cart.sellerId && cart.sellerId !== product.sellerId) {
      await db.cartItem.deleteMany({ where: { cartId: cart.id } });
      await cartScope(orgId, (client) =>
        client.cart.update({
          where: { id: cart.id },
          data: { sellerId: product.sellerId },
        }),
      );
    } else if (!cart.sellerId) {
      await cartScope(orgId, (client) =>
        client.cart.update({
          where: { id: cart.id },
          data: { sellerId: product.sellerId },
        }),
      );
    }

    const availableStock = data.skuId
      ? ((await db.productSKU.findUnique({ where: { id: data.skuId } }))
        ?.stock ?? 0)
      : (product.stock ?? 0);

    const existing = data.skuId
      ? await db.cartItem.findUnique({
        where: {
          cartId_productId_skuId: {
            cartId: cart.id,
            productId: data.productId,
            skuId: data.skuId,
          },
        },
      })
      : await db.cartItem.findFirst({
        where: { cartId: cart.id, productId: data.productId, skuId: null },
      });

    const newQuantity = (existing?.quantity ?? 0) + data.quantity;
    if (newQuantity > availableStock) throw new Error("Insufficient stock");

    if (existing) {
      await db.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: newQuantity,
          ...(data.negotiationId
            ? {
                negotiationId: data.negotiationId,
                negotiatedPrice,
                negotiatedExpiresAt,
              }
            : {}),
        },
      });
    } else {
      await db.cartItem.create({
        data: {
          cartId: cart.id,
          productId: data.productId,
          skuId: data.skuId,
          quantity: data.quantity,
          negotiationId: data.negotiationId ?? null,
          negotiatedPrice,
          negotiatedExpiresAt,
        },
      });
    }

    return getCartWithItems(userId, orgId);
  },

  async updateItem(userId: string, itemId: string, quantity: number, orgId?: OrgId) {
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");

    const cart = await getOrCreateCart(userId, orgId);
    const item = await db.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true, sku: true },
    });
    if (!item) throw new Error("Cart item not found");

    const availableStock = item.sku?.stock ?? item.product.stock ?? 0;
    if (quantity > availableStock) throw new Error("Insufficient stock");

    await db.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return getCartWithItems(userId, orgId);
  },

  async removeItem(userId: string, itemId: string, orgId?: OrgId) {
    const cart = await getOrCreateCart(userId, orgId);
    const item = await db.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) throw new Error("Cart item not found");

    await db.cartItem.delete({ where: { id: itemId } });

    const remaining = await db.cartItem.count({ where: { cartId: cart.id } });
    if (remaining === 0)
      await cartScope(orgId, (client) =>
        client.cart.update({
          where: { id: cart.id },
          data: { sellerId: null },
        }),
      );

    return getCartWithItems(userId, orgId);
  },

  async clearCart(userId: string, orgId?: OrgId) {
    const cart = await getOrCreateCart(userId, orgId);
    await db.cartItem.deleteMany({ where: { cartId: cart.id } });
    await cartScope(orgId, (client) =>
      client.cart.update({ where: { id: cart.id }, data: { sellerId: null } }),
    );
    return { cleared: true };
  },

  async checkout(
    userId: string,
    idempotencyKey: string,
    data: {
      addressId?: string;
      newAddress?: any;
      couponCode?: string;
      paymentMethod?: "ONLINE" | "COD";
      requiredBy?: string;
      customerNotes?: string;
      multiLocation?: boolean;
      addressSheetUrl?: string;
    },
    orgId?: OrgId,
  ) {
    const existing = await orderService.findOrderByIdempotencyKey(userId, idempotencyKey, orgId);
    if (existing) return existing;

    const { cart, items, subtotal, sellerId } = await getCartWithItems(userId, orgId);
    if (!items.length) throw new Error("Cart is empty");
    if (!sellerId) throw new Error("Cart has no seller assigned");

    // Preserve buyer delivery requirements from the negotiated session on the order
    const negotiatedItem = items.find((i) => i.negotiationId);
    const negotiationIntent = negotiatedItem?.negotiationId
      ? (
          (await db.negotiationSession.findUnique({
            where: { id: negotiatedItem.negotiationId },
            select: { intent: true },
          }))?.intent ?? undefined
        )
      : undefined;

    let deliveryAddress;
    if (data.addressId) {
      const addr = await db.customerAddress.findFirst({
        where: { id: data.addressId, userId },
      });
      if (!addr) throw new Error("Address not found");
      deliveryAddress = addr;
    } else if (data.newAddress) {
      deliveryAddress = data.newAddress;
    } else {
      throw new Error("Delivery address required");
    }

    const paymentMethod = data.paymentMethod ?? "ONLINE";

    if (paymentMethod === "COD") {
      const seller = await db.seller.findUnique({
        where: { id: sellerId },
        select: { pincode: true, city: true },
      });
      if (!seller) throw new Error("Cart has no seller assigned");
      const norm = (c?: string | null) => (c ?? "").trim().toLowerCase();
      if (!norm(seller.city) || norm(seller.city) !== norm(deliveryAddress.city)) {
        throw new Error("Cash on Delivery is only available when the seller is in your city");
      }
      const codLimit = await getPlatformConfigNumber("COD_MAX_ORDER_VALUE", COD_DEFAULT_MAX_ORDER_VALUE);
      if (Number(subtotal) > codLimit) {
        throw new Error(`Cash on Delivery is only available for orders up to ₹${codLimit}`);
      }

      const weightKg =
        items.reduce((sum, i) => sum + i.weightGrams * i.quantity, 0) / 1000;

      const serviceability = await shipmentService.checkServiceability(
        seller.pincode,
        deliveryAddress.pincode,
        weightKg,
        true,
      );
      if (!serviceability.available) {
        throw new Error("Cash on Delivery is not available for this address");
      }
    }

    const buildOrderInput = (discount: number, couponCode?: string, couponId?: string) => ({
      sellerId,
      type: "STANDARD" as const,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        skuId: i.skuId ?? undefined,
      })),
      deliveryAddress: {
        receiverName: deliveryAddress.receiverName,
        phone: deliveryAddress.phone,
        street: deliveryAddress.street,
        city: deliveryAddress.city,
        state: deliveryAddress.state,
        pincode: deliveryAddress.pincode,
        latitude: deliveryAddress.latitude
          ? Number(deliveryAddress.latitude)
          : undefined,
        longitude: deliveryAddress.longitude
          ? Number(deliveryAddress.longitude)
          : undefined,
      },
      discountAmount: discount > 0 ? discount : undefined,
      couponCode,
      couponId,
      paymentMethod,
      requiredBy: data.requiredBy,
      customerNotes: data.customerNotes,
      multiLocation: data.multiLocation,
      addressSheetUrl: data.addressSheetUrl,
      negotiationIntent,
      orgId: orgId ?? undefined,
    });

    let order;
    if (data.couponCode) {
      const result = await couponService.checkoutWithCoupon(
        data.couponCode,
        userId,
        subtotal,
        items.map((i) => i.productId),
        (discount, couponCode, couponId) =>
          orderService.createOrder(userId, idempotencyKey, buildOrderInput(discount, couponCode, couponId)),
      );
      order = result.order;
    } else {
      order = await orderService.createOrder(userId, idempotencyKey, buildOrderInput(0));
    }

    await db.cartItem.deleteMany({ where: { cartId: cart.id } });
    await cartScope(orgId, (client) =>
      client.cart.update({ where: { id: cart.id }, data: { sellerId: null } }),
    );

    return order;
  },
};
