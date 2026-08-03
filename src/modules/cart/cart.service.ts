import { db } from "../../db/index";
import { orderService } from "../order/order.service";
import { couponService } from "../coupon/coupon.service";
import { shipmentService } from "../shipment/shipment.service";

async function getOrCreateCart(userId: string) {
  let cart = await db.cart.findUnique({ where: { userId } });
  if (!cart) {
    try {
      cart = await db.cart.create({ data: { userId } });
    } catch (err: any) {
      if (err.code === "P2002") {
        cart = await db.cart.findUniqueOrThrow({ where: { userId } });
      } else {
        throw err;
      }
    }
  }
  return cart;
}

async function getCartWithItems(userId: string) {
  const cart = await getOrCreateCart(userId);

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
    const unitPrice = Number(item.sku?.price ?? item.product.price ?? 0);
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
    };
  });

  return { cart, items: lineItems, subtotal, sellerId: cart.sellerId };
}

export const cartService = {
  async getCart(userId: string) {
    return getCartWithItems(userId);
  },

  async addItem(
    userId: string,
    data: { productId: string; skuId?: string; quantity: number },
  ) {
    const product = await db.product.findUnique({
      where: { id: data.productId },
    });
    if (!product) throw new Error("Product not found");
    if (product.status !== "APPROVED") throw new Error("Product not available");

    const cart = await getOrCreateCart(userId);

    if (cart.sellerId && cart.sellerId !== product.sellerId) {
      await db.cartItem.deleteMany({ where: { cartId: cart.id } });
      await db.cart.update({
        where: { id: cart.id },
        data: { sellerId: product.sellerId },
      });
    } else if (!cart.sellerId) {
      await db.cart.update({
        where: { id: cart.id },
        data: { sellerId: product.sellerId },
      });
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
        data: { quantity: newQuantity },
      });
    } else {
      await db.cartItem.create({
        data: {
          cartId: cart.id,
          productId: data.productId,
          skuId: data.skuId,
          quantity: data.quantity,
        },
      });
    }

    return getCartWithItems(userId);
  },

  async updateItem(userId: string, itemId: string, quantity: number) {
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");

    const cart = await getOrCreateCart(userId);
    const item = await db.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true, sku: true },
    });
    if (!item) throw new Error("Cart item not found");

    const availableStock = item.sku?.stock ?? item.product.stock ?? 0;
    if (quantity > availableStock) throw new Error("Insufficient stock");

    await db.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return getCartWithItems(userId);
  },

  async removeItem(userId: string, itemId: string) {
    const cart = await getOrCreateCart(userId);
    const item = await db.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) throw new Error("Cart item not found");

    await db.cartItem.delete({ where: { id: itemId } });

    const remaining = await db.cartItem.count({ where: { cartId: cart.id } });
    if (remaining === 0)
      await db.cart.update({
        where: { id: cart.id },
        data: { sellerId: null },
      });

    return getCartWithItems(userId);
  },

  async clearCart(userId: string) {
    const cart = await getOrCreateCart(userId);
    await db.cartItem.deleteMany({ where: { cartId: cart.id } });
    await db.cart.update({ where: { id: cart.id }, data: { sellerId: null } });
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
    },
  ) {
    const { cart, items, subtotal, sellerId } = await getCartWithItems(userId);
    if (!items.length) throw new Error("Cart is empty");
    if (!sellerId) throw new Error("Cart has no seller assigned");

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
        select: { pincode: true },
      });
      if (!seller) throw new Error("Cart has no seller assigned");

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

    const buildOrderInput = (discount: number, couponCode?: string) => ({
      sellerId,
      type: "STANDARD" as const,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
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
      paymentMethod,
    });

    let order;
    if (data.couponCode) {
      const result = await couponService.checkoutWithCoupon(
        data.couponCode,
        userId,
        subtotal,
        items.map((i) => i.productId),
        (discount, couponCode) =>
          orderService.createOrder(userId, idempotencyKey, buildOrderInput(discount, couponCode)),
      );
      order = result.order;
    } else {
      order = await orderService.createOrder(userId, idempotencyKey, buildOrderInput(0));
    }

    await db.cartItem.deleteMany({ where: { cartId: cart.id } });
    await db.cart.update({ where: { id: cart.id }, data: { sellerId: null } });

    return order;
  },
};
