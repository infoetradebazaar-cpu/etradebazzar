import { db } from "../../db/index";
import { ShipmentFactory } from "../../lib/shipment/shipment.factory";
import { notificationService } from "../notification/notification.service";
import { logger } from "../../utils/logger";
import { generateDisplayId } from "../../lib/uid/uid.generator";
import { creditEngine } from "../../lib/credit-engine/credit-rules";
import { reliabilityService } from "../../lib/order-assignment/reliability.service";
import { Shipment } from "../../../prisma/generated/client";

async function performShipmentTrack(shipment: Shipment) {
  if (!shipment.trackingId) throw new Error("No tracking ID available yet");

  const provider = ShipmentFactory.get();

  try {
    const result = await provider.trackShipment(shipment.trackingId);

    const statusMap: Record<string, string> = {
      "DELIVERED": "DELIVERED",
      "IN TRANSIT": "IN_TRANSIT",
      "OUT FOR DELIVERY": "OUT_FOR_DELIVERY",
      "RETURNED": "RETURNED",
      "CANCELED": "FAILED",
    };

    const mappedStatus = statusMap[result.currentStatus.toUpperCase()];
    if (mappedStatus && mappedStatus !== shipment.status) {
      await db.shipment.update({
        where: { id: shipment.id },
        data: { status: mappedStatus as any },
      });

      if (mappedStatus === "OUT_FOR_DELIVERY") {
        await db.order.update({
          where: { id: shipment.orderId },
          data: { status: "OUT_FOR_DELIVERY" },
        });
      }

      const order = await db.order.findUnique({
        where: { id: shipment.orderId },
        select: {
          customerId: true,
          customer: { select: { email: true, name: true } },
        },
      });

      if (order?.customer) {
        notificationService
          .shipmentUpdated({
            userId: order.customerId,
            email: order.customer.email,
            customerName: order.customer.name ?? "Customer",
            orderId: shipment.orderId,
            status: mappedStatus,
            trackingId: shipment.trackingId ?? undefined,
            trackingUrl: shipment.trackingUrl ?? undefined,
          })
          .catch(() => null);
      }
    }

    return result.raw;
  } catch (err: any) {
    logger.warn({ err: err.message }, "Tracking unavailable");
    return { shipment, tracking: null };
  }
}

const STATUS_FORWARD_MAP: Record<string, string> = {
  PENDING: "pending", BOOKED: "booked", IN_TRANSIT: "in_transit",
  OUT_FOR_DELIVERY: "out_for_delivery", DELIVERED: "delivered",
  FAILED: "cancelled", RETURNED: "rto",
};
const STATUS_REVERSE_MAP: Record<string, string> = {
  pending: "PENDING", booked: "BOOKED", in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY", delivered: "DELIVERED",
  cancelled: "FAILED", rto: "RETURNED",
};

export const shipmentService = {
  async createShipmentForPackedOrder(
    orderId: string,
    sellerId: string,
    shopId: string,
    orderAddressId: string,
  ) {
    const order = await db.order.findFirst({
      where: { id: orderId, sellerId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new Error("Order not found");
    if (order.status !== "PACKED") throw new Error("Order not packed");

    if (order.assignedShopId !== shopId) {
      throw new Error("Shop does not match the order's assigned shop");
    }

    const shop = await db.shop.findFirst({ where: { id: shopId, sellerId } });
    if (!shop) throw new Error("Shop not found");

    const address = await db.orderAddress.findFirst({ where: { id: orderAddressId, orderId } });
    if (!address) throw new Error("Delivery address not found");

    const provider = ShipmentFactory.get();
    let trackingId: string | null = null;
    let trackingUrl: string | null = null;

    try {
      const result = await provider.createShipment({
        orderId,
        pickupLocation: shop.name,
        receiverName: address.receiverName,
        address: address.street,
        city: address.city,
        pincode: address.pincode,
        state: address.state,
        country: "India",
        email: shop.contactEmail,
        phone: address.phone,
        paymentMethod: order.paymentMethod === "COD" ? "COD" : "Prepaid",
        subTotal: Number(order.finalAmount ?? order.totalAmount),
        length: 10,
        breadth: 10,
        height: 10,
        weight: order.items.reduce(
          (acc, item) =>
            acc + ((item.product.weightGrams ?? 500) * item.quantity) / 1000,
          0,
        ),
        items: order.items.map((item) => ({
          name: item.product.name,
          sku: item.product.sku ?? item.productId,
          units: item.quantity,
          sellingPrice: Number(item.finalUnitPrice ?? item.unitPrice),
          weight: (item.product.weightGrams ?? 500) / 1000,
        })),
      });
      trackingId = result.trackingId;
      trackingUrl = result.trackingUrl;
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        "Shipment provider unavailable  saving without tracking",
      );
    }

    const shipment = await db.$transaction(async (tx) => {
      const displayId = await generateDisplayId("shipment");
      const created = await tx.shipment.create({
        data: {
          orderId,
          shopId,
          orderAddressId: orderAddressId ?? null,
          displayId,
          provider: process.env.SHIPMENT_PROVIDER ?? "shiprocket",
          trackingId,
          trackingUrl,
          status: trackingId ? "BOOKED" : "PENDING",
        },
      });

      if (trackingId) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "SHIPPED" },
        });
      }

      if (orderAddressId) {
        await tx.orderAddress.update({
          where: { id: orderAddressId },
          data: { fulfillmentStatus: trackingId ? "SHIPPED" : "PROCESSING" },
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId: shopId,
          actorType: "shop",
          action: "SHIPMENT_CREATED",
          entityType: "shipment",
          entityId: created.id,
          metadata: { trackingId, orderId },
        },
      });

      return created;
    });

    const orderWithCustomer = await db.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        customer: { select: { email: true, name: true } },
      },
    });

    if (orderWithCustomer?.customer) {
      notificationService
        .shipmentUpdated({
          userId: orderWithCustomer.customerId,
          email: orderWithCustomer.customer.email,
          customerName: orderWithCustomer.customer.name ?? "Customer",
          orderId,
          status: shipment.status,
          trackingId: trackingId ?? undefined,
          trackingUrl: trackingUrl ?? undefined,
        })
        .catch(() => null);
    }

    return shipment;
  },

  async trackShipment(sellerId: string, shipmentId: string) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, order: { sellerId } },
    });
    if (!shipment) throw new Error("Shipment not found");
    return performShipmentTrack(shipment);
  },

  async trackShipmentAsCustomer(customerId: string, shipmentId: string) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, order: { customerId } },
    });
    if (!shipment) throw new Error("Shipment not found");
    return performShipmentTrack(shipment);
  },

  async cancelShipment(sellerId: string, shipmentId: string, actorId: string) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId, order: { sellerId } },
      include: { order: true },
    });
    if (!shipment) throw new Error("Shipment not found");
    if (shipment.status === "DELIVERED")
      throw new Error("Cannot cancel delivered shipment");

    const updated = await db.$transaction(async (tx) => {
      const updateResult = await tx.shipment.updateMany({
        where: { id: shipmentId, status: { not: "DELIVERED" } },
        data: { status: "FAILED" },
      });

      if (updateResult.count === 0) {
        throw new Error("Cannot cancel delivered shipment");
      }

      await tx.auditLog.create({
        data: {
          sellerId: shipment.order.sellerId,
          actorId,
          actorType: "seller",
          action: "SHIPMENT_CANCELLED",
          entityType: "shipment",
          entityId: shipmentId,
          metadata: { trackingId: shipment.trackingId },
        },
      });

      return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    });

    if (shipment.trackingId) {
      const provider = ShipmentFactory.get();
      try {
        await provider.cancelShipment([shipment.trackingId]);
      } catch (err: any) {
        logger.error(
          { err: err.message, shipmentId, trackingId: shipment.trackingId },
          "Courier cancel failed after DB already marked shipment cancelled - needs reconciliation",
        );
        await db.auditLog.create({
          data: {
            sellerId: shipment.order.sellerId,
            actorId,
            actorType: "seller",
            action: "SHIPMENT_CANCEL_PROVIDER_FAILED",
            entityType: "shipment",
            entityId: shipmentId,
            metadata: { trackingId: shipment.trackingId, error: err.message },
          },
        });
      }
    }

    return updated;
  },

  async handleWebhook(payload: Buffer | string, signature: string) {
    const provider = ShipmentFactory.get();

    if (!provider.verifyWebhook(payload, signature)) {
      throw new Error("Invalid webhook signature");
    }

    const event = provider.parseWebhookEvent(payload);
    logger.info(
      { event: event.event, status: event.status },
      "Shipment webhook received",
    );

    const shipment = await db.shipment.findFirst({
      where: { trackingId: event.trackingId },
    });
    if (!shipment) return { received: true };

    const statusMap: Record<string, string> = {
      "delivered": "DELIVERED",
      "in transit": "IN_TRANSIT",
      "out for delivery": "OUT_FOR_DELIVERY",
      "returned": "RETURNED",
      "canceled": "FAILED",
      "rto": "RETURNED",
    };

    const mappedStatus = statusMap[event.status.toLowerCase()];
    if (!mappedStatus || mappedStatus === shipment.status)
      return { received: true };

    await db.shipment.update({
      where: { id: shipment.id },
      data: { status: mappedStatus as any },
    });

    if (mappedStatus === "OUT_FOR_DELIVERY") {
      await db.order.update({
        where: { id: shipment.orderId },
        data: { status: "OUT_FOR_DELIVERY" },
      });
    }

    if (mappedStatus === "RETURNED") {
      await db.order.update({
        where: { id: shipment.orderId },
        data: { status: "UNFULFILLABLE" },
      });
    }

    if (mappedStatus === "DELIVERED") {
      const deliveredOrder = await db.order.findUnique({
        where: { id: shipment.orderId },
        select: { paymentMethod: true, assignedShopId: true },
      });

      await db.order.update({
        where: { id: shipment.orderId },
        data: {
          status: "DELIVERED",
          ...(deliveredOrder?.paymentMethod === "COD"
            ? { paymentStatus: "PAID" }
            : {}),
        },
      });

      if (deliveredOrder?.assignedShopId) {
        reliabilityService.recomputeReliability(deliveredOrder.assignedShopId).catch(() => null);
      }
    }

    const orderForCredit = await db.order.findUnique({
      where: { id: shipment.orderId },
      select: { customerId: true },
    });
    if (orderForCredit) {
      creditEngine.awardOrderCompletion(orderForCredit.customerId, shipment.orderId).catch(() => null);
    }
    const order = await db.order.findUnique({
      where: { id: shipment.orderId },
      select: {
        customerId: true,
        customer: { select: { email: true, name: true } },
      },
    });

    if (order?.customer) {
      notificationService
        .shipmentUpdated({
          userId: order.customerId,
          email: order.customer.email,
          customerName: order.customer.name ?? "Customer",
          orderId: shipment.orderId,
          status: mappedStatus,
          trackingId: event.trackingId,
          trackingUrl: shipment.trackingUrl ?? undefined,
        })
        .catch(() => null);
    }

    return { received: true };
  },

  async checkServiceability(
    pickupPincode: string,
    deliveryPincode: string,
    weightKg: number,
    cod: boolean,
  ) {
    const provider = ShipmentFactory.get();
    return provider.getServiceability(
      pickupPincode,
      deliveryPincode,
      weightKg,
      cod,
    );
  },

  async listShipments(
    filters: {
      sellerId?: string; status?: string; search?: string; shopId?: string; courierPartner?: string;
      dateFrom?: string; dateTo?: string; page?: number; limit?: number;
      sortBy?: string; sortOrder?: "asc" | "desc";
    }
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);
    const allowedSort = ["createdAt", "estimatedDelivery"];
    const sortBy = allowedSort.includes(filters.sortBy ?? "") ? filters.sortBy! : "createdAt";
    const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

    const where: any = filters.sellerId ? { order: { sellerId: filters.sellerId } } : {};
    if (filters.status) where.status = STATUS_REVERSE_MAP[filters.status] ?? filters.status.toUpperCase();
    if (filters.shopId) where.shopId = filters.shopId;
    if (filters.courierPartner) where.provider = { equals: filters.courierPartner, mode: "insensitive" };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search, mode: "insensitive" } },
        { displayId: { contains: filters.search, mode: "insensitive" } },
        { trackingId: { contains: filters.search, mode: "insensitive" } },
        { order: { displayId: { contains: filters.search, mode: "insensitive" } } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.shipment.findMany({
        where,
        select: {
          id: true, displayId: true, status: true, trackingId: true, trackingUrl: true,
          provider: true, estimatedDelivery: true, createdAt: true,
          order: { select: { id: true, displayId: true, type: true, totalAmount: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.shipment.count({ where }),
    ]);

    const data = rows.map(s => ({
      ...s,
      status: (STATUS_FORWARD_MAP[s.status] || s.status.toLowerCase()) as any,
      courierPartner: s.provider?.toLowerCase() as any,
    }));

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  },

  async getShipment(shipmentId: string) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId },
      include: {
        order: {
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
            customer: { select: { id: true, name: true } },
            seller: { select: { id: true, name: true } },
          },
        },
        orderAddress: true,
        shop: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!shipment) throw new Error("Shipment not found");

    const orderStatusMap: Record<string, string> = {
      PENDING: "pending",
      CONFIRMED: "confirmed",
      PROCESSING: "processing",
      NEGOTIATING: "negotiating",
      SHIPPED: "shipped",
      DELIVERED: "delivered",
      CANCELLED: "cancelled",
      RETURNED: "returned",
    };

    return {
      ...shipment,
      status: (STATUS_FORWARD_MAP[shipment.status] || shipment.status.toLowerCase()) as any,
      courierPartner: shipment.provider?.toLowerCase() as any,
      order: shipment.order
        ? {
          ...shipment.order,
          customerId: shipment.order.customerId,
          sellerId: shipment.order.sellerId,
          status: (orderStatusMap[shipment.order.status] ||
            shipment.order.status.toLowerCase()) as any,
          paymentStatus: (shipment.order.paymentStatus?.toLowerCase() ||
            "unpaid") as any,
          totalAmount: shipment.order.totalAmount
            ? Number(shipment.order.totalAmount)
            : undefined,
          total: shipment.order.totalAmount
            ? Number(shipment.order.totalAmount)
            : undefined,
          items: shipment.order.items.map((item) => ({
            ...item,
            price: Number(item.unitPrice),
            negotiatedPrice: item.finalUnitPrice
              ? Number(item.finalUnitPrice)
              : undefined,
            sku: item.sku?.sku || item.product?.sku,
          })),
          shippingAddress: shipment.orderAddress
            ? {
              name: shipment.orderAddress.receiverName,
              phone: shipment.orderAddress.phone,
              line1: shipment.orderAddress.street,
              line2: "",
              city: shipment.orderAddress.city,
              state: shipment.orderAddress.state,
              pincode: shipment.orderAddress.pincode,
              country: "India",
            }
            : shipment.order.addresses?.[0]
              ? {
                name: shipment.order.addresses[0].receiverName,
                phone: shipment.order.addresses[0].phone,
                line1: shipment.order.addresses[0].street,
                line2: "",
                city: shipment.order.addresses[0].city,
                state: shipment.order.addresses[0].state,
                pincode: shipment.order.addresses[0].pincode,
                country: "India",
              }
              : undefined,
        }
        : undefined,
    };
  },

  async getShipmentWithOrder(shipmentId: string) {
    const shipment = await db.shipment.findFirst({
      where: { id: shipmentId },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            status: true,
            totalAmount: true,
            finalAmount: true,
            createdAt: true,
          },
        },
      },
    });
    if (!shipment) throw new Error("Shipment not found");

    return {
      shipmentId: shipment.id,
      shipmentDisplayId: shipment.displayId ?? shipment.id,
      orderId: shipment.order.id,
      orderDisplayId: shipment.order.displayId ?? shipment.order.id,
      courierPartner: shipment.provider,
      AWB: shipment.trackingId,
      shipmentStatus: shipment.status,
      orderStatus: shipment.order.status,
      assignedDate: shipment.createdAt,
      deliveredDate:
        shipment.status === "DELIVERED" ? shipment.updatedAt : null,
      trackingUrl: shipment.trackingUrl,
    };
  },

  async listShipmentsWithOrders(sellerId?: string) {
    const shipments = await db.shipment.findMany({
      where: sellerId ? { order: { sellerId } } : {},
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            status: true,
            totalAmount: true,
            finalAmount: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return shipments.map((s) => ({
      shipmentId: s.id,
      shipmentDisplayId: s.displayId ?? s.id,
      orderId: s.order.id,
      orderDisplayId: s.order.displayId ?? s.order.id,
      courierPartner: s.provider,
      AWB: s.trackingId,
      shipmentStatus: s.status,
      orderStatus: s.order.status,
      assignedDate: s.createdAt,
      deliveredDate: s.status === "DELIVERED" ? s.updatedAt : null,
      trackingUrl: s.trackingUrl,
    }));
  },
  async bulkCancel(sellerId: string, actorId: string, shipmentIds: string[]) {
    const MAX_BULK = 100;
    if (shipmentIds.length > MAX_BULK) {
      throw new Error(`Cannot cancel more than ${MAX_BULK} shipments at once`);
    }

    let success = 0;
    const failures: { shipmentId: string; error: string }[] = [];

    for (const shipmentId of shipmentIds) {
      try {
        await this.cancelShipment(sellerId, shipmentId, actorId);
        success++;
      } catch (err: any) {
        logger.error({ err: err.message, shipmentId }, "Bulk cancel item failed");
        failures.push({ shipmentId, error: err.message });
      }
    }

    return { success, failed: failures.length, failures };
  },
  async exportShipmentsCsv(sellerId?: string) {
    return db.shipment.findMany({
      where: sellerId ? { order: { sellerId } } : {},
      select: {
        id: true, displayId: true, status: true, provider: true, trackingId: true,
        createdAt: true, order: { select: { displayId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
