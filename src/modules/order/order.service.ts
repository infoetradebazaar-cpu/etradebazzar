import { db } from "../../db/index";
import { redis } from "../../db/redis";
import { logger } from "../../utils/logger";
import { getCommissionRate } from "../../utils/commission";
import { notificationService } from "../notification/notification.service";
import { checkLowStock } from "../../lib/inventory/inventory.alert";
import { InsufficientStockError } from "../../lib/inventory/stock.errors";
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
import { canAccessOrgResource } from "../../lib/permission/customer-org-permission.service";
import { CUSTOMER_ORG_PERMISSIONS } from "../../lib/permission/customer-org-permission.constants";

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

function idempotencyScope(customerId: string, orgId?: string | null): string {
  return orgId ? `org:${orgId}` : customerId;
}

function idempotencyRedisKey(
  customerId: string,
  idempotencyKey: string,
  orgId?: string | null,
): string {
  return `order:idem:${idempotencyScope(customerId, orgId)}:${idempotencyKey}`;
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
      items: { productId: string; quantity: number; skuId?: string }[];
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
      orgId?: string;
    },
  ) {
    const idemKey = idempotencyRedisKey(customerId, idempotencyKey, data.orgId);

    const existingOrderId = await redis.get(idemKey);
    if (existingOrderId) {
      return this.getOrder(existingOrderId, customerId);
    }

    const lockKey = `create:${idempotencyScope(customerId, data.orgId)}:${idempotencyKey}`;
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
      items: { productId: string; quantity: number; skuId?: string }[];
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
      orgId?: string;
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

    const requestedSkuIds = data.items
      .map((i) => i.skuId)
      .filter((id): id is string => !!id);
    const skus = requestedSkuIds.length
      ? await db.productSKU.findMany({ where: { id: { in: requestedSkuIds } } })
      : [];
    const skuById = new Map(skus.map((s) => [s.id, s]));
    for (const item of data.items) {
      if (item.skuId && skuById.get(item.skuId)?.productId !== item.productId) {
        throw new Error("Invalid SKU for product");
      }
    }

    let totalAmount = 0;
    const itemsData = data.items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      const sku = item.skuId ? skuById.get(item.skuId) : undefined;
      const unitPrice = sku ? Number(sku.price) : Number(product.price);
      totalAmount += unitPrice * item.quantity;
      return { productId: item.productId, skuId: item.skuId, quantity: item.quantity, unitPrice };
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

    const orderType = data.type;
    const commissionRate = await getCommissionRate(
      primaryProduct.id,
      categoryName,
    );
    const commissionAmount =
      ((finalAmount ?? totalAmount) * commissionRate) / 100;

    const displayId = await generateDisplayId("order");

    let initialStatus: "PENDING_ASSIGNMENT" | "CONFIRMED" =
      "PENDING_ASSIGNMENT";
    let autoAssignedShopId: string | null = null;

    const trusted = await recommendationService.hasTrustedShops(
      data.sellerId,
    );
    if (trusted) {
      const recs = await recommendationService.computeRecommendations(
        data.sellerId,
        data.items.map((i) => ({
          productId: i.productId,
          skuId: i.skuId,
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
          orgId: data.orgId ?? null,
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
        if (item.skuId) {
          const updated = await tx.productSKU.updateMany({
            where: { id: item.skuId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (updated.count === 0) {
            throw new InsufficientStockError(`Insufficient stock for product: ${product.name}`);
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
        } else {
          const prevStock = product.stock ?? 0;
          const updated = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (updated.count === 0) {
            throw new InsufficientStockError(`Insufficient stock for product: ${product.name}`);
          }
          checkLowStock(
            item.productId,
            prevStock,
            prevStock - item.quantity,
          ).catch(() => null);
        }
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
    items: { productId: string; quantity: number; skuId?: string }[],
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
    items: { productId: string; quantity: number; skuId?: string }[],
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

    // Same SKU-aware pricing as _createOrderInner see comment there.
    const requestedSkuIds = items.map((i) => i.skuId).filter((id): id is string => !!id);
    const skus = requestedSkuIds.length
      ? await db.productSKU.findMany({ where: { id: { in: requestedSkuIds } } })
      : [];
    const skuById = new Map(skus.map((s) => [s.id, s]));
    for (const item of items) {
      if (item.skuId && skuById.get(item.skuId)?.productId !== item.productId) {
        throw new Error("Invalid SKU for product");
      }
    }

    let totalAmount = 0;
    const itemsData = items.map((item) => {
      const product = products.find((p) => p.id === item.productId)!;
      const sku = item.skuId ? skuById.get(item.skuId) : undefined;
      const unitPrice = sku ? Number(sku.price) : Number(product.price);
      totalAmount += unitPrice * item.quantity;
      return { productId: item.productId, skuId: item.skuId, quantity: item.quantity, unitPrice };
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
        if (item.skuId) {
          const updated = await tx.productSKU.updateMany({
            where: { id: item.skuId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (updated.count === 0) {
            throw new InsufficientStockError(`Insufficient stock for product: ${product.name}`);
          }
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.quantity } },
          });
          continue;
        }
        const prevStock = product.stock ?? 0;
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (updated.count === 0) {
          throw new InsufficientStockError(`Insufficient stock for product: ${product.name}`);
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
        addresses: true,
        assignedShop: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, name: true } },
        shipments: true,
        payments: true,
      },
    });
    if (!order) throw new Error("Order not found");

    if (requesterId !== undefined && requesterRole !== "super_admin") {
      const isCustomer =
        order.customerId === requesterId ||
        (await canAccessOrgResource(
          requesterId,
          order.orgId,
          CUSTOMER_ORG_PERMISSIONS.VIEW_ORDER_HISTORY,
        ));
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
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);

    const mapped = data.map((o) => ({
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
    }));

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
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
    ]);

    const mapped = data.map((o) => ({
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
    }));

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
      const isCustomer =
        order.customerId === requesterId ||
        (await canAccessOrgResource(
          requesterId,
          order.orgId,
          CUSTOMER_ORG_PERMISSIONS.VIEW_ORDER_HISTORY,
        ));
      const isOwningSeller =
        requesterSellerId && order.sellerId === requesterSellerId;
      if (!isCustomer && !isOwningSeller) {
        throw new Error("Order not found");
      }
    }

    const CANCELLABLE_STATUSES: OrderStatus[] = [
      "PENDING",
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
        if (item.skuId) {
          await tx.productSKU.update({
            where: { id: item.skuId },
            data: { stock: { increment: item.quantity } },
          });
        }
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
      confirm: ["PENDING", "PENDING_ASSIGNMENT"],
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

  async getActionRequired(sellerId: string) {
    const pendingOrders = await db.order.findMany({
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
    });

    return {
      pendingOrders: pendingOrders.map((o) => ({
        ...o,
        status: o.status.toLowerCase(),
      })),
    };
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
