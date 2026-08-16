import { db } from "../../db/index";
import { redis } from "../../db/redis";
import { logger } from "../../utils/logger";
import { getCommissionRate, isHighTicket, isOverQuantityThreshold } from "../../utils/commission";
import { notificationService } from "../notification/notification.service";
import { checkLowStock } from "../../lib/inventory/inventory.alert";
import { triggerAnalyticsRefresh } from "../../lib/analytics/analytics.events";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { creditEngine } from "../../lib/credit-engine/credit-rules";
import { recommendationService } from "../../lib/order-assignment/recommendation.service";
import { shopAccessService } from "../shop/shop-access.service";
import { reliabilityService } from "../../lib/order-assignment/reliability.service";
import { OrderStatus } from "../../../prisma/generated/client";
import { slaConfigService } from "../platform/sla-config.service";
import { shipmentService } from "../shipment/shipment.service";
import { paymentService } from "../payment/payment.service";

const ORDER_LOCK_TTL = 15;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24; // 24h durable window

async function acquireOrderLock(key: string): Promise<boolean> {
  const result = await redis.set(
    `order:lock:${key}`,
    "1",
    "EX",
    ORDER_LOCK_TTL,
    "NX",
  );
  return result === "OK";
}

async function releaseOrderLock(key: string): Promise<void> {
  await redis.del(`order:lock:${key}`);
}

function idempotencyRedisKey(
  customerId: string,
  idempotencyKey: string,
): string {
  return `order:idem:${customerId}:${idempotencyKey}`;
}

async function getCustomerContact(customerId: string) {
  return db.user.findUnique({
    where: { id: customerId },
    select: { email: true, name: true },
  });
}

export const orderService = {
  async createOrder(
    customerId: string,
    idempotencyKey: string,
    data: {
      sellerId: string;
      type: "STANDARD" | "SAMPLE";
      items: { productId: string; quantity: number }[];
      deliveryAddress: {
        receiverName: string;
        phone: string;
        street: string;
        city: string;
        state: string;
        pincode: string;
        latitude?: number;
        longitude?: number;
      };
      discountAmount?: number;
      couponCode?: string;
      paymentMethod?: "ONLINE" | "COD";
    },
  ) {
    const idemKey = idempotencyRedisKey(customerId, idempotencyKey);

    const existingOrderId = await redis.get(idemKey);
    if (existingOrderId) {
      return this.getOrder(existingOrderId, customerId);
    }

    const lockKey = `create:${customerId}:${idempotencyKey}`;
    const locked = await acquireOrderLock(lockKey);
    if (!locked) {
      throw new Error("Duplicate order submission detected, please wait");
    }

    try {
      const raceFixed = await redis.get(idemKey);
      if (raceFixed) {
        return this.getOrder(raceFixed, customerId);
      }

      const order = await this._createOrderInner(customerId, data);
      await redis.setex(idemKey, IDEMPOTENCY_TTL_SECONDS, order.id);
      return order;
    } finally {
      await releaseOrderLock(lockKey);
    }
  },

  async _createOrderInner(
    customerId: string,
    data: {
      sellerId: string;
      type: "STANDARD" | "SAMPLE";
      items: { productId: string; quantity: number }[];
      deliveryAddress: {
        receiverName: string;
        phone: string;
        street: string;
        city: string;
        state: string;
        pincode: string;
        latitude?: number;
        longitude?: number;
      };
      discountAmount?: number;
      couponCode?: string;
      paymentMethod?: "ONLINE" | "COD";
    },
  ) {
    const products = await db.product.findMany({
      where: {
        id: { in: data.items.map((i) => i.productId) },
        sellerId: data.sellerId,
        status: "LIVE",
      },
      include: { category: { select: { name: true } } },
    });

    if (products.length !== data.items.length) {
      throw new Error("One or more products not found or not approved");
    }

    if (
      data.type === "SAMPLE" &&
      data.items.reduce((a, b) => a + b.quantity, 0) > 2
    ) {
      throw new Error("Sample orders limited to 2 items");
    }

    let totalAmount = 0;
    const itemsData = data.items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      const unitPrice = Number(product.price);
      totalAmount += unitPrice * item.quantity;
      return { productId: item.productId, quantity: item.quantity, unitPrice };
    });

    const discountAmount =
      data.discountAmount && data.discountAmount > 0
        ? Math.min(data.discountAmount, totalAmount)
        : 0;
    const finalAmount =
      discountAmount > 0
        ? parseFloat((totalAmount - discountAmount).toFixed(2))
        : undefined;

    const primaryItem = itemsData.reduce((max, cur) =>
      cur.unitPrice * cur.quantity > max.unitPrice * max.quantity ? cur : max,
    );
    const primaryProduct = products.find(
      (p) => p.id === primaryItem.productId,
    )!;
    const categoryName = primaryProduct.category.name;

    const highTicket =
      (await isHighTicket(data.sellerId, categoryName, totalAmount)) ||
      isOverQuantityThreshold(data.items, products);
    const orderType = highTicket ? "HIGH_TICKET" : data.type;
    const commissionRate = await getCommissionRate(
      primaryProduct.id,
      categoryName,
    );
    const commissionAmount =
      ((finalAmount ?? totalAmount) * commissionRate) / 100;

    const displayId = await generateDisplayId("order");

    let initialStatus: "NEGOTIATING" | "PENDING_ASSIGNMENT" | "CONFIRMED" =
      highTicket ? "NEGOTIATING" : "PENDING_ASSIGNMENT";
    let autoAssignedShopId: string | null = null;

    if (!highTicket) {
      const trusted = await recommendationService.hasTrustedShops(
        data.sellerId,
      );
      if (trusted) {
        const recs = await recommendationService.computeRecommendations(
          data.sellerId,
          data.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
          })),
          data.deliveryAddress.latitude,
          data.deliveryAddress.longitude,
        );
        const topPick = recs[0];
        if (topPick?.autoAssignEnabled && topPick.stockScore >= 80) {
          initialStatus = "CONFIRMED";
          autoAssignedShopId = topPick.shopId;
        }
      }
    }
    const packingSla =
      initialStatus === "CONFIRMED"
        ? await slaConfigService.getSlaConfig()
        : null;
    const packingDeadline = packingSla?.packing_sla_hours
      ? new Date(Date.now() + packingSla.packing_sla_hours * 60 * 60 * 1000)
      : undefined;

    const order = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;

      const created = await tx.order.create({
        data: {
          sellerId: data.sellerId,
          customerId,
          type: orderType,
          displayId,
          status: initialStatus,
          totalAmount,
          finalAmount,
          discountAmount: discountAmount > 0 ? discountAmount : undefined,
          commissionRate,
          commissionAmount,
          paymentMethod: data.paymentMethod ?? "ONLINE",
          assignedShopId: autoAssignedShopId,
          packingDeadline,
          items: { create: itemsData },
          addresses: {
            create: {
              ...data.deliveryAddress,
              assignedShopId: autoAssignedShopId,
              fulfillmentStatus: autoAssignedShopId ? "ASSIGNED" : "PENDING",
            },
          },
        },
        include: { items: true, addresses: true },
      });

      for (const item of itemsData) {
        const product = products.find((p) => p.id === item.productId)!;
        const prevStock = product.stock ?? 0;
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count === 0) {
          throw new Error(
            `Insufficient stock for product: ${products.find((p) => p.id === item.productId)!.name}`,
          );
        }
        checkLowStock(
          item.productId,
          prevStock,
          prevStock - item.quantity,
        ).catch(() => null);
      }

      await tx.auditLog.create({
        data: {
          sellerId: data.sellerId,
          actorId: customerId,
          actorType: "customer",
          action: "ORDER_CREATED",
          entityType: "order",
          entityId: created.id,
          metadata: {
            type: orderType,
            totalAmount,
            finalAmount,
            discountAmount,
            couponCode: data.couponCode,
          },
        },
      });

      return created;
    });

    if (autoAssignedShopId) {
      db.auditLog
        .create({
          data: {
            sellerId: data.sellerId,
            actorId: customerId,
            actorType: "system",
            action: "SHOP_AUTO_ASSIGNED",
            entityType: "order",
            entityId: order.id,
            metadata: { shopId: autoAssignedShopId },
          },
        })
        .catch(() => null);
    }

    triggerAnalyticsRefresh("ORDER_CREATED", data.sellerId).catch(() => null);

    const customer = await getCustomerContact(customerId);
    if (customer) {
      notificationService
        .orderPlaced({
          userId: customerId,
          email: customer.email,
          customerName: customer.name ?? "Customer",
          orderId: order.id,
          orderType,
          items: itemsData.map((i) => {
            const p = products.find((p) => p.id === i.productId)!;
            return {
              name: p.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            };
          }),
          totalAmount,
        })
        .catch(() => null);
    }

    return order;
  },

  async createBulkOrder(
    customerId: string,
    idempotencyKey: string,
    sellerId: string,
    items: { productId: string; quantity: number }[],
    file: Express.Multer.File,
  ) {
    const idemKey = idempotencyRedisKey(customerId, idempotencyKey);

    const existingOrderId = await redis.get(idemKey);
    if (existingOrderId) {
      return this.getOrder(existingOrderId, customerId);
    }

    const lockKey = `create:bulk:${customerId}:${idempotencyKey}`;
    const locked = await acquireOrderLock(lockKey);
    if (!locked) {
      throw new Error("Duplicate order submission detected, please wait");
    }

    try {
      const raceFixed = await redis.get(idemKey);
      if (raceFixed) {
        return this.getOrder(raceFixed, customerId);
      }

      const order = await this._createBulkOrderInner(
        customerId,
        sellerId,
        items,
        file,
      );
      await redis.setex(idemKey, IDEMPOTENCY_TTL_SECONDS, order.id);
      return order;
    } finally {
      await releaseOrderLock(lockKey);
    }
  },

  async _createBulkOrderInner(
    customerId: string,
    sellerId: string,
    items: { productId: string; quantity: number }[],
    file: Express.Multer.File,
  ) {
    const MAX_BULK_ROWS = 500;

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("XLS file is empty");
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("XLS file is empty");
    const rows = XLSX.utils.sheet_to_json<any>(sheet);

    if (!rows.length) throw new Error("XLS file is empty");
    if (rows.length > MAX_BULK_ROWS) {
      throw new Error(
        `Bulk upload exceeds maximum of ${MAX_BULK_ROWS} addresses`,
      );
    }

    const requiredCols = [
      "receiverName",
      "phone",
      "street",
      "city",
      "state",
      "pincode",
    ];
    const missing = requiredCols.filter((col) => !(col in rows[0]));
    if (missing.length)
      throw new Error(`Missing columns: ${missing.join(", ")}`);

    const products = await db.product.findMany({
      where: {
        id: { in: items.map((i) => i.productId) },
        sellerId,
        status: "LIVE",
      },
      include: { category: { select: { name: true } } },
    });
    if (products.length !== items.length)
      throw new Error("One or more products invalid");

    let totalAmount = 0;
    const itemsData = items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      const unitPrice = Number(product.price);
      totalAmount += unitPrice * item.quantity;
      return { productId: item.productId, quantity: item.quantity, unitPrice };
    });

    const primaryItem = itemsData.reduce((max, cur) =>
      cur.unitPrice * cur.quantity > max.unitPrice * max.quantity ? cur : max,
    );
    const primaryProduct = products.find(
      (p) => p.id === primaryItem.productId,
    )!;

    const commissionRate = await getCommissionRate(
      primaryProduct.id,
      primaryProduct.category.name,
    );
    const commissionAmount = (totalAmount * commissionRate) / 100;

    const displayId = await generateDisplayId("order");

    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;

      const order = await tx.order.create({
        data: {
          sellerId,
          customerId,
          type: "BULK",
          displayId,
          status: "PENDING",
          totalAmount,
          commissionRate,
          commissionAmount,
          items: { create: itemsData },
          addresses: {
            create: rows.map((row: any) => ({
              receiverName: String(row.receiverName),
              phone: String(row.phone),
              street: String(row.street),
              city: String(row.city),
              state: String(row.state),
              pincode: String(row.pincode),
              latitude: row.latitude ? Number(row.latitude) : null,
              longitude: row.longitude ? Number(row.longitude) : null,
            })),
          },
        },
        include: { addresses: true },
      });

      for (const item of itemsData) {
        const product = products.find((p) => p.id === item.productId)!;
        const prevStock = product.stock ?? 0;
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count === 0) {
          throw new Error(
            `Insufficient stock for product: ${products.find((p) => p.id === item.productId)!.name}`,
          );
        }
        checkLowStock(
          item.productId,
          prevStock,
          prevStock - item.quantity,
        ).catch(() => null);
      }

      await tx.bulkUpload.create({
        data: {
          orderId: order.id,
          uploadedBy: customerId,
          fileName: file.originalname,
          status: "COMPLETED",
          totalAddresses: rows.length,
          assignedCount: 0,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId: customerId,
          actorType: "customer",
          action: "BULK_ORDER_CREATED",
          entityType: "order",
          entityId: order.id,
          metadata: { totalAddresses: rows.length },
        },
      });

      return order;
    });
  },
  async submitProposal(
    orderId: string,
    actorId: string,
    actorType: string,
    sellerId: string | undefined,
    data: { proposedPrice: number; note?: string; meetLink?: string },
  ) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");

    const isCustomer = actorType === "customer" && order.customerId === actorId;
    const isOwningSeller =
      actorType === "seller" && sellerId && order.sellerId === sellerId;
    if (!isCustomer && !isOwningSeller) {
      throw new Error("Order not found");
    }

    if (order.status !== "NEGOTIATING")
      throw new Error("Order is not in negotiation");

    return db.$transaction(async (tx) => {
      const negotiation = await tx.orderNegotiation.create({
        data: {
          orderId,
          proposedBy: actorId,
          proposedByType: actorType,
          proposedPrice: data.proposedPrice,
          note: data.note,
          meetLink: data.meetLink,
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId,
          actorType,
          action: "PROPOSAL_SUBMITTED",
          entityType: "order_negotiation",
          entityId: negotiation.id,
          metadata: { proposedPrice: data.proposedPrice },
        },
      });

      return negotiation;
    });
  },

  async respondToProposal(
    orderId: string,
    negotiationId: string,
    actorId: string,
    actorType: string,
    sellerId: string | undefined,
    data: {
      action: "ACCEPT" | "REJECT" | "COUNTER";
      counterPrice?: number;
      note?: string;
    },
  ) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");

    const isCustomer = actorType === "customer" && order.customerId === actorId;
    const isOwningSeller =
      actorType === "seller" && sellerId && order.sellerId === sellerId;
    if (!isCustomer && !isOwningSeller) {
      throw new Error("Order not found");
    }

    const newStatus =
      data.action === "ACCEPT"
        ? "ACCEPTED"
        : data.action === "REJECT"
          ? "REJECTED"
          : "COUNTERED";

    const result = await db.$transaction(async (tx) => {
      const updateResult = await tx.orderNegotiation.updateMany({
        where: { id: negotiationId, orderId, status: "PENDING" },
        data: { status: newStatus },
      });

      if (updateResult.count === 0) {
        throw new Error("Proposal already responded to");
      }

      const negotiation = await tx.orderNegotiation.findUniqueOrThrow({
        where: { id: negotiationId },
      });

      if (data.action === "ACCEPT") {
        const { packing_sla_hours } = await slaConfigService.getSlaConfig();
        const recomputedCommissionAmount = order.commissionRate
          ? (Number(negotiation.proposedPrice) * Number(order.commissionRate)) / 100
          : undefined;
        await tx.order.update({
          where: { id: orderId },
          data: {
            finalAmount: negotiation.proposedPrice,
            commissionAmount: recomputedCommissionAmount,
            status: "CONFIRMED",
            packingDeadline: packing_sla_hours
              ? new Date(Date.now() + packing_sla_hours * 60 * 60 * 1000)
              : undefined,
          },
        });
      }

      if (data.action === "COUNTER" && data.counterPrice) {
        await tx.orderNegotiation.create({
          data: {
            orderId,
            proposedBy: actorId,
            proposedByType: actorType,
            proposedPrice: data.counterPrice,
            note: data.note,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId,
          actorType,
          action: `PROPOSAL_${data.action}ED`,
          entityType: "order_negotiation",
          entityId: negotiationId,
          metadata: { action: data.action, counterPrice: data.counterPrice },
        },
      });

      return {
        order: await tx.order.findUnique({
          where: { id: orderId },
          include: { negotiations: true },
        }),
        negotiation,
      };
    });

    // Notify customer on accept
    if (data.action === "ACCEPT") {
      const customer = await getCustomerContact(order.customerId);
      if (customer) {
        notificationService
          .orderConfirmed({
            userId: order.customerId,
            email: customer.email,
            customerName: customer.name ?? "Customer",
            orderId,
            finalAmount: Number(result.negotiation.proposedPrice),
          })
          .catch(() => null);
      }
      triggerAnalyticsRefresh("ORDER_CREATED", order.sellerId).catch(
        () => null,
      );
    }

    return result.order;
  },

  async assignShopToAddress(
    orderId: string,
    addressId: string,
    shopId: string,
    actorId: string,
    sellerId: string,
  ) {
    const order = await db.order.findFirst({
      where: { id: orderId, sellerId },
    });
    if (!order) throw new Error("Order not found");

    const address = await db.orderAddress.findFirst({
      where: { id: addressId, orderId },
    });
    if (!address) throw new Error("Address not found");

    const shop = await db.shop.findFirst({
      where: { id: shopId, sellerId },
    });
    if (!shop) throw new Error("Shop not found");
    if (shop.status !== "APPROVED") throw new Error("Shop not approved");

    return db.$transaction(async (tx) => {
      const updateResult = await tx.orderAddress.updateMany({
        where: {
          id: addressId,
          orderId,
          fulfillmentStatus: { not: "ASSIGNED" },
        },
        data: {
          assignedShopId: shopId,
          assignedBy: actorId,
          fulfillmentStatus: "ASSIGNED",
        },
      });

      if (updateResult.count === 0) {
        throw new Error("Address already assigned");
      }
      const orderForDeadline = await tx.order.findUnique({
        where: { id: orderId },
        select: { packingDeadline: true },
      });
      const { packing_sla_hours } = await slaConfigService.getSlaConfig();

      await tx.order.update({
        where: { id: orderId },
        data: {
          assignedShopId: shopId,
          ...(!orderForDeadline?.packingDeadline &&
            packing_sla_hours && {
              packingDeadline: new Date(
                Date.now() + packing_sla_hours * 60 * 60 * 1000,
              ),
            }),
        },
      });

      await tx.bulkUpload.updateMany({
        where: { orderId },
        data: { assignedCount: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: {
          sellerId,
          actorId,
          actorType: "seller",
          action: "SHOP_ASSIGNED_TO_ADDRESS",
          entityType: "order_address",
          entityId: addressId,
          metadata: { shopId },
        },
      });

      return tx.orderAddress.findUniqueOrThrow({ where: { id: addressId } });
    });
  },

  async setThreshold(
    sellerId: string,
    data: { productCategory?: string; amount: number },
  ) {
    return db.orderThreshold.upsert({
      where: {
        sellerId_productCategory: {
          sellerId,
          productCategory: (data.productCategory as string) ?? null,
        },
      },
      update: { amount: data.amount },
      create: {
        sellerId,
        productCategory: data.productCategory,
        amount: data.amount,
      },
    });
  },

  async getThresholds(sellerId: string) {
    const rows = await db.orderThreshold.findMany({
      where: { sellerId },
      orderBy: { productCategory: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      sellerId: r.sellerId,
      productCategory: r.productCategory,
      amount: Number(r.amount),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  },

async deleteThreshold(sellerId: string, productCategory: string) {
    const where =
      productCategory === "default"
        ? { sellerId, productCategory: null }
        : { sellerId, productCategory };

    const result = await db.orderThreshold.deleteMany({ where });
    if (result.count === 0) {
        throw new Error("Threshold not found");
    }
    return result;
},

  async markPacked(orderId: string, sellerId: string, actorId: string) {
    const order = await db.order.findFirst({
      where: { id: orderId, sellerId },
      include: { addresses: true },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== "CONFIRMED") {
      throw new Error(`Cannot mark packed current status is ${order.status}`);
    }
    if (!order.assignedShopId) {
      throw new Error("Order has no shop assigned yet");
    }

    const address =
      order.addresses.find((a) => a.assignedShopId === order.assignedShopId) ??
      order.addresses[0];
    if (!address) throw new Error("Order address not found");
    if (
      address.assignedShopId &&
      address.assignedShopId !== order.assignedShopId
    ) {
      throw new Error("Assigned shop does not match the address assignment");
    }

    const { dispatch_upload_sla_hours } = await slaConfigService.getSlaConfig();
    const packedAt = new Date();
    const dispatchDeadline = dispatch_upload_sla_hours
      ? new Date(
          packedAt.getTime() + dispatch_upload_sla_hours * 60 * 60 * 1000,
        )
      : undefined;

    const updateResult = await db.order.updateMany({
      where: { id: orderId, status: "CONFIRMED" },
      data: { status: "PACKED", packedAt, dispatchDeadline },
    });
    if (updateResult.count === 0) {
      throw new Error("Order was already packed or its status changed");
    }

    await db.auditLog.create({
      data: {
        sellerId,
        actorId,
        actorType: "seller",
        action: "ORDER_PACKED",
        entityType: "order",
        entityId: orderId,
      },
    });

    try {
      await shipmentService.createShipmentForPackedOrder(
        orderId,
        sellerId,
        order.assignedShopId,
        address.id,
      );
    } catch (err: any) {
      await db.auditLog.create({
        data: {
          sellerId,
          actorId: "system",
          actorType: "system",
          action: "COURIER_BOOKING_FAILED",
          entityType: "order",
          entityId: orderId,
          metadata: { error: err.message },
        },
      });
    }

    return this.getOrder(orderId, undefined, sellerId);
  },
  async setCommission(
    actorId: string,
    data: { productId?: string; category?: string; rate: number },
  ) {
    if (!data.productId && !data.category)
      throw new Error("Provide productId or category");
    return db.productCommission.create({
      data: {
        productId: data.productId,
        category: data.category,
        rate: data.rate,
        setBy: actorId,
      },
    });
  },

  async getOrder(
    orderId: string,
    requesterId?: string,
    requesterSellerId?: string,
    requesterRole?: string,
  ) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                sku: true,
                images: { orderBy: { order: "asc" }, take: 1 },
              },
            },
            sku: true,
          },
        },
        negotiations: { orderBy: { createdAt: "desc" } },
        addresses: true,
        assignedShop: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, name: true } },
        shipments: true,
        payments: true,
      },
    });
    if (!order) throw new Error("Order not found");

    if (requesterId !== undefined && requesterRole !== "super_admin") {
      const isCustomer = order.customerId === requesterId;
      const isOwningSeller =
        requesterSellerId && order.sellerId === requesterSellerId;
      if (!isCustomer && !isOwningSeller) {
        throw new Error("Order not found");
      }
      // if (
      //   isOwningSeller &&
      //   !isCustomer &&
      //   order.paymentMethod === "ONLINE" &&
      //   order.paymentStatus !== "PAID"
      // ) {
      //   throw new Error("Order not found");
      // }
    }

    return {
      ...order,
      shopId: order.assignedShopId,
      status: order.status.toLowerCase(),
      paymentStatus: (order.paymentStatus as string).toLowerCase(),
      totalAmount: order.totalAmount ? Number(order.totalAmount) : null,
      finalAmount: order.finalAmount ? Number(order.finalAmount) : null,
      items: order.items.map((item) => ({
        ...item,
        price: Number(item.unitPrice),
        negotiatedPrice: item.finalUnitPrice
          ? Number(item.finalUnitPrice)
          : undefined,
        sku: item.sku?.sku || item.product?.sku,
      })),
      addresses: order.addresses.map((addr) => ({
        ...addr,
        shopId: addr.assignedShopId,
        assignmentStatus: addr.fulfillmentStatus.toLowerCase(),
      })),
    };
  },

  async listOrders(
    sellerId: string,
    userId: string,
    filters: {
      status?: string;
      search?: string;
      type?: string;
      shopId?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const accessibleShopIds = await shopAccessService.getAccessibleShopIds(sellerId, userId);

    const where: any = {
      sellerId,
      // NOT: { paymentMethod: "ONLINE", paymentStatus: { not: "PAID" } },
    };
    if (filters.status) where.status = filters.status.toUpperCase();
    if (filters.type) where.type = filters.type.toUpperCase();
    if (filters.shopId) {
      where.assignedShopId = filters.shopId;
    } else if (accessibleShopIds !== null) {
      where.assignedShopId = { in: accessibleShopIds };
    }
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search, mode: "insensitive" } },
        { displayId: { contains: filters.search, mode: "insensitive" } },
        {
          customer: { name: { contains: filters.search, mode: "insensitive" } },
        },
      ];
    }

    const [data, total] = await Promise.all([
      db.order.findMany({
        where,
        include: {
          items: { include: { product: { select: { id: true, name: true } } } },
          customer: { select: { id: true, name: true } },
          addresses: true,
          assignedShop: { select: { id: true, name: true } },
          negotiations: { orderBy: { createdAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);

    const mapped = data.map((o) => {
      const latestNeg = o.negotiations?.[0];
      return {
        ...o,
        shopId: o.assignedShopId,
        status: o.status.toLowerCase(),
        paymentStatus: (o.paymentStatus as string).toLowerCase(),
        totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
        finalAmount: o.finalAmount ? Number(o.finalAmount) : null,
        commissionAmount: o.commissionAmount
          ? Number(o.commissionAmount)
          : null,
        addresses: o.addresses.map((addr) => ({
          ...addr,
          shopId: addr.assignedShopId,
          assignmentStatus: addr.fulfillmentStatus.toLowerCase(),
        })),
        negotiation: latestNeg
          ? {
              id: latestNeg.id,
              orderId: latestNeg.orderId,
              proposedBy:
                latestNeg.proposedByType === "customer" ? "customer" : "seller",
              proposedAmount: Number(latestNeg.proposedPrice),
              message: latestNeg.note ?? undefined,
              status: latestNeg.status.toLowerCase(),
              createdAt: latestNeg.createdAt,
              expiresAt: undefined,
            }
          : undefined,
      };
    });

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async listAllOrders(filters: {
    status?: string;
    search?: string;
    type?: string;
    sellerId?: string;
    shopId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const where: any = {};
    if (filters.status) where.status = filters.status.toUpperCase();
    if (filters.type) where.type = filters.type.toUpperCase();
    if (filters.sellerId) where.sellerId = filters.sellerId;
    if (filters.shopId) where.assignedShopId = filters.shopId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search, mode: "insensitive" } },
        { displayId: { contains: filters.search, mode: "insensitive" } },
        {
          customer: { name: { contains: filters.search, mode: "insensitive" } },
        },
      ];
    }

    const [data, total] = await Promise.all([
      db.order.findMany({
        where,
        include: {
          items: { include: { product: { select: { id: true, name: true } } } },
          customer: { select: { id: true, name: true } },
          seller: { select: { id: true, businessName: true } },
          addresses: true,
          assignedShop: { select: { id: true, name: true } },
          negotiations: { orderBy: { createdAt: "desc" } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);

    const mapped = data.map((o) => {
      const latestNeg = o.negotiations?.[0];
      return {
        ...o,
        shopId: o.assignedShopId,
        status: o.status.toLowerCase(),
        paymentStatus: (o.paymentStatus as string).toLowerCase(),
        totalAmount: o.totalAmount ? Number(o.totalAmount) : null,
        finalAmount: o.finalAmount ? Number(o.finalAmount) : null,
        commissionAmount: o.commissionAmount
          ? Number(o.commissionAmount)
          : null,
        addresses: o.addresses.map((addr) => ({
          ...addr,
          shopId: addr.assignedShopId,
          assignmentStatus: addr.fulfillmentStatus.toLowerCase(),
        })),
        negotiation: latestNeg
          ? {
              id: latestNeg.id,
              orderId: latestNeg.orderId,
              proposedBy:
                latestNeg.proposedByType === "customer" ? "customer" : "seller",
              proposedAmount: Number(latestNeg.proposedPrice),
              message: latestNeg.note ?? undefined,
              status: latestNeg.status.toLowerCase(),
              createdAt: latestNeg.createdAt,
              expiresAt: undefined,
            }
          : undefined,
      };
    });

    return {
      data: mapped,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async adminAssignShop(orderId: string, shopId: string, actorId: string) {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Order not found");

    const shop = await db.shop.findFirst({ where: { id: shopId, sellerId: order.sellerId } });
    if (!shop) throw new Error("Shop not found");
    if (shop.status !== "APPROVED") throw new Error("Shop not approved");

    const { packing_sla_hours } = await slaConfigService.getSlaConfig();

    return db.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: "PENDING_ASSIGNMENT" },
        data: {
          assignedShopId: shopId,
          status: "CONFIRMED",
          ...(packing_sla_hours && {
            packingDeadline: new Date(Date.now() + packing_sla_hours * 60 * 60 * 1000),
          }),
        },
      });
      if (claimed.count === 0) {
        throw new Error("Order is not awaiting assignment");
      }

      await tx.orderAddress.updateMany({
        where: { orderId, fulfillmentStatus: { not: "ASSIGNED" } },
        data: { assignedShopId: shopId, assignedBy: actorId, fulfillmentStatus: "ASSIGNED" },
      });

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId,
          actorType: "platform",
          action: "ORDER_MANUALLY_ASSIGNED",
          entityType: "order",
          entityId: orderId,
          metadata: { shopId },
        },
      });

      return tx.order.findUnique({ where: { id: orderId } });
    });
  },

  async cancelOrder(
    orderId: string,
    actorId: string,
    actorType: string,
    requesterId?: string,
    requesterSellerId?: string,
  ) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: true,
        customer: { select: { id: true, email: true, name: true } },
      },
    });
    if (!order) throw new Error("Order not found");

    if (requesterId !== undefined) {
      const isCustomer = order.customerId === requesterId;
      const isOwningSeller =
        requesterSellerId && order.sellerId === requesterSellerId;
      if (!isCustomer && !isOwningSeller) {
        throw new Error("Order not found");
      }
    }

    const CANCELLABLE_STATUSES: OrderStatus[] = [
      "PENDING",
      "NEGOTIATING",
      "CONFIRMED",
      "PACKED",
      "PROCESSING",
      "PENDING_ASSIGNMENT",
    ];

    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;

      const updateResult = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { in: CANCELLABLE_STATUSES },
        },
        data: { status: "CANCELLED" },
      });

      if (updateResult.count === 0) {
        throw new Error("Order cannot be cancelled");
      }

      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId,
          actorType,
          action: "ORDER_CANCELLED",
          entityType: "order",
          entityId: orderId,
        },
      });

      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });

    if (order.assignedShopId) {
      reliabilityService
        .recomputeReliability(order.assignedShopId)
        .catch(() => null);
    }

    creditEngine
      .checkCancelPenalty(order.customerId, orderId, order.createdAt)
      .catch(() => null);

    if (order.customer?.email) {
      notificationService
        .orderCancelled({
          userId: order.customer.id,
          email: order.customer.email,
          customerName: order.customer.name ?? "Customer",
          orderId,
        })
        .catch(() => null);
    }

    if (order.payments.some((p) => p.status === "PAID")) {
      paymentService.initiateRefund(orderId, actorId).catch((err) => {
        logger.error(
          { err: err.message, orderId },
          "Auto-refund on cancel failed",
        );
      });
    }

    triggerAnalyticsRefresh("ORDER_CANCELLED", order.sellerId).catch(
      () => null,
    );
    return result;
  },

  async bulkAction(
    sellerId: string,
    actorId: string,
    data: { orderIds: string[]; action: "confirm" | "cancel" | "ship" },
  ) {
    const MAX_BULK_ORDERS = 100;
    if (data.orderIds.length > MAX_BULK_ORDERS) {
      throw new Error(
        `Cannot process more than ${MAX_BULK_ORDERS} orders at once`,
      );
    }

    const VALID_SOURCE_STATUSES: Record<
      "confirm" | "ship" | "cancel",
      OrderStatus[]
    > = {
      confirm: ["PENDING", "PENDING_ASSIGNMENT", "NEGOTIATING"],
      ship: ["CONFIRMED", "PROCESSING"],
      cancel: [],
    };

    const statusMap = {
      confirm: "CONFIRMED",
      cancel: "CANCELLED",
      ship: "SHIPPED",
    } as const;
    const targetStatus = statusMap[data.action];

    let success = 0,
      failed = 0;

    for (const orderId of data.orderIds) {
      try {
        const order = await db.order.findFirst({
          where: { id: orderId, sellerId },
        });
        if (!order) {
          failed++;
          continue;
        }

        if (data.action === "cancel") {
          await this.cancelOrder(orderId, actorId, "seller");
        } else {
          const updateResult = await db.order.updateMany({
            where: {
              id: orderId,
              sellerId,
              status: { in: VALID_SOURCE_STATUSES[data.action] },
            },
            data: { status: targetStatus },
          });
          if (updateResult.count === 0) {
            failed++;
            continue;
          }
        }
        success++;
      } catch (err: any) {
        logger.error(
          { err: err.message, orderId, action: data.action },
          "Bulk order action item failed",
        );
        failed++;
      }
    }

    return { success, failed };
  },

  async bulkRespondNegotiations(
    sellerId: string,
    actorId: string,
    data: {
      orderIds: string[];
      action: "ACCEPT" | "REJECT";
      counterPrice?: number;
      note?: string;
    },
  ) {
    const MAX_BULK_ORDERS = 100;
    if (data.orderIds.length > MAX_BULK_ORDERS) {
      throw new Error(
        `Cannot process more than ${MAX_BULK_ORDERS} orders at once`,
      );
    }

    let success = 0,
      failed = 0;

    for (const orderId of data.orderIds) {
      try {
        const order = await db.order.findFirst({
          where: { id: orderId, sellerId },
        });
        if (!order) {
          failed++;
          continue;
        }

        const negotiation = await db.orderNegotiation.findFirst({
          where: { orderId, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });
        if (!negotiation) {
          failed++;
          continue;
        }

        await this.respondToProposal(
          orderId,
          negotiation.id,
          actorId,
          "seller",
          sellerId,
          {
            action: data.action,
            counterPrice: data.counterPrice,
            note: data.note,
          },
        );
        success++;
      } catch (err: any) {
        logger.error(
          { err: err.message, orderId },
          "Bulk respond negotiation item failed",
        );
        failed++;
      }
    }

    return { success, failed };
  },

  async getActionRequired(sellerId: string) {
    const expiryThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000); // negotiations older 48 hrs

    const [pendingOrders, expiringNegotiations] = await Promise.all([
      db.order.findMany({
        where: { sellerId, status: { in: ["PENDING", "PROCESSING"] } },
        select: {
          id: true,
          displayId: true,
          type: true,
          status: true,
          totalAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
      db.order.findMany({
        where: {
          sellerId,
          status: "NEGOTIATING",
          negotiations: {
            some: { status: "PENDING", createdAt: { lte: expiryThreshold } },
          },
        },
        select: {
          id: true,
          displayId: true,
          type: true,
          status: true,
          totalAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
    ]);

    return { pendingOrders, expiringNegotiations };
  },

  async exportOrdersCsv(
    sellerId: string,
    filters: {
      status?: string;
      type?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const where: any = { sellerId };
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }

    return db.order.findMany({
      where,
      select: {
        id: true,
        displayId: true,
        type: true,
        status: true,
        totalAmount: true,
        finalAmount: true,
        paymentStatus: true,
        createdAt: true,
        customer: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async listBulkUploads(sellerId: string) {
    const uploads = await db.bulkUpload.findMany({
      where: { order: { sellerId } },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            status: true,
            totalAmount: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return uploads.map((u) => ({
      id: u.id,
      orderId: u.orderId,
      orderDisplayId: u.order.displayId,
      orderStatus: u.order.status.toLowerCase(),
      totalAmount: u.order.totalAmount ? Number(u.order.totalAmount) : null,
      uploadedBy: u.uploadedBy,
      fileName: u.fileName,
      status: u.status.toLowerCase(),
      totalAddresses: u.totalAddresses,
      assignedCount: u.assignedCount,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  },
};
