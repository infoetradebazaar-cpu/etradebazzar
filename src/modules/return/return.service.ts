import { db } from "../../db/index";
import { ShipmentFactory } from "../../lib/shipment/shipment.factory";
import { notificationService } from "../notification/notification.service";
import { paymentService } from "../payment/payment.service";
import { logger } from "../../utils/logger";
import { triggerAnalyticsRefresh } from "../../lib/analytics/analytics.events";
import type { WebhookEvent } from "../../lib/shipment/shipment.interface";
import { config } from "../../../config/config";
import { shopAccessService } from "../shop/shop-access.service";

// NOTE: exact status strings Shiprocket sends for reverse-pickup shipments
const RETURN_STATUS_MAP: Record<string, "IN_TRANSIT" | "DELIVERED" | "FAILED"> = {
  "picked up": "IN_TRANSIT",
  "in transit": "IN_TRANSIT",
  "delivered": "DELIVERED",
  "canceled": "FAILED",
};

export const returnService = {
  async createReturnRequest(
    customerId: string,
    data: { orderId: string; reason: string; imageAssetIds?: string[] },
  ) {
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new Error("Order not found");
    if (order.customerId !== customerId) throw new Error("Unauthorized");
    if (order.status !== "DELIVERED")
      throw new Error("Order not delivered yet");

    const existing = await db.returnRequest.findFirst({
      where: { orderId: data.orderId, status: { not: "REJECTED" } },
    });
    if (existing) throw new Error("Return request already exists");
    const imageAssetIds = data.imageAssetIds ?? [];
    if (imageAssetIds.length > 0) {
      const ownedUnattached = await db.customerUploadAsset.count({
        where: { id: { in: imageAssetIds }, userId: customerId, returnRequestId: null },
      });
      if (ownedUnattached !== imageAssetIds.length) {
        throw new Error("One or more images are invalid or already attached");
      }
    }

    const returnRequest = await db.$transaction(async (tx) => {
      const created = await tx.returnRequest.create({
        data: {
          orderId: data.orderId,
          customerId,
          reason: data.reason,
        },
      });

      if (imageAssetIds.length > 0) {
        await tx.customerUploadAsset.updateMany({
          where: { id: { in: imageAssetIds }, userId: customerId, returnRequestId: null },
          data: { returnRequestId: created.id },
        });
      }

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId: customerId,
          actorType: "customer",
          action: "RETURN_REQUESTED",
          entityType: "return_request",
          entityId: created.id,
          metadata: { reason: data.reason, imageCount: imageAssetIds.length },
        },
      });

      return created;
    });

    const owner = await db.sellerMember.findFirst({
      where: { sellerId: order.sellerId, role: { name: "owner" } },
      select: { userId: true },
    });
    const seller = await db.seller.findUnique({
      where: { id: order.sellerId },
      select: { email: true, name: true },
    });

    if (owner && seller) {
      notificationService
        .notify({
          userId: owner.userId,
          email: seller.email,
          type: "RETURN_REQUESTED",
          title: "Return request received",
          message: `A return request has been raised for order #${data.orderId}`,
          channels: ["email", "sse"],
          emailTemplate: "return-requested",
          emailData: {
            sellerName: seller.name,
            orderId: data.orderId,
            returnUrl: `${config.appUrl}/returns/${returnRequest.id}`,
          },
          data: { orderId: data.orderId, returnId: returnRequest.id },
        })
        .catch(() => null);
    }

    return returnRequest;
  },

  async approveReturn(returnId: string, sellerId: string, actorId: string, note?: string) {
    const returnRequest = await db.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        order: {
          include: { items: { include: { product: true } }, addresses: true },
        },
      },
    });
    if (!returnRequest) throw new Error("Return request not found");
    if (returnRequest.order.sellerId !== sellerId) throw new Error("Return request not found");
    if (returnRequest.status !== "PENDING")
      throw new Error("Return request not pending");

    const order = returnRequest.order;
    const address = order.addresses[0];
    if (!address) throw new Error("Order address not found");

    const shop = await db.shop.findFirst({
      where: { sellerId: order.sellerId },
      select: {
        name: true,
        contactEmail: true,
        pickupStreet: true,
        pickupCity: true,
        pickupPincode: true,
        pickupState: true,
        contactPhone: true,
      },
    });
    if (!shop) throw new Error("Shop not found");

    const provider = ShipmentFactory.get();
    let trackingId: string | null = null;
    let trackingUrl: string | null = null;

    try {
      const result = await provider.createReversePickup({
        orderId: returnRequest.id,
        pickupLocation: shop.name,
        receiverName: address.receiverName,
        address: address.street,
        city: address.city,
        pincode: address.pincode,
        state: address.state,
        country: "India",
        email: shop.contactEmail,
        phone: address.phone,
        paymentMethod: "Prepaid",
        subTotal: Number(order.totalAmount),
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
        "Reverse pickup failed  approving without tracking",
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.returnRequest.update({
        where: { id: returnId },
        data: { status: "APPROVED", approvedBy: actorId, note: note ?? null },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "RETURNED" },
      });

      await tx.returnShipment.create({
        data: {
          returnRequestId: returnId,
          trackingId,
          trackingUrl,
          status: trackingId ? "BOOKED" : "PENDING",
        },
      });

      await tx.auditLog.create({
        data: {
          sellerId: order.sellerId,
          actorId,
          actorType: "seller",
          action: "RETURN_APPROVED",
          entityType: "return_request",
          entityId: returnId,
          metadata: { note, trackingId },
        },
      });

      return result;
    });

    const customer = await db.user.findUnique({
      where: { id: returnRequest.customerId },
      select: { email: true, name: true },
    });

    if (customer) {
      notificationService
        .notify({
          userId: returnRequest.customerId,
          email: customer.email,
          type: "RETURN_APPROVED",
          title: "Return approved",
          message: `Your return request for order #${returnRequest.orderId} has been approved.`,
          channels: ["email", "sse"],
          emailTemplate: "return-approved",
          emailData: {
            customerName: customer.name ?? "there",
            orderId: returnRequest.orderId,
            trackingId,
            trackingUrl,
            returnUrl: `${config.appUrl}/returns/${returnId}`,
          },
          data: { returnId, trackingId, trackingUrl },
        })
        .catch(() => null);
    }

    triggerAnalyticsRefresh("RETURN_COMPLETED", order.sellerId).catch(
      () => null,
    );
    return updated;
  },

  async rejectReturn(returnId: string, sellerId: string, actorId: string, note: string) {
    const returnRequest = await db.returnRequest.findUnique({
      where: { id: returnId },
      include: { order: { select: { sellerId: true } } },
    });
    if (!returnRequest) throw new Error("Return request not found");
    if (returnRequest.order.sellerId !== sellerId) 
      throw new Error("Return request not found");
    if (returnRequest.status !== "PENDING")
      throw new Error("Return request not pending");

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.returnRequest.update({
        where: { id: returnId },
        data: { status: "REJECTED", rejectedBy: actorId, note },
      });

      await tx.auditLog.create({
        data: {
          sellerId: returnRequest.order.sellerId,
          actorId,
          actorType: "seller",
          action: "RETURN_REJECTED",
          entityType: "return_request",
          entityId: returnId,
          metadata: { note },
        },
      });

      return result;
    });

    const customer = await db.user.findUnique({
      where: { id: returnRequest.customerId },
      select: { email: true, name: true },
    });

    if (customer) {
      notificationService
        .notify({
          userId: returnRequest.customerId,
          email: customer.email,
          type: "RETURN_REJECTED",
          title: "Return rejected",
          message: `Your return request for order #${returnRequest.orderId} was rejected. Reason: ${note}`,
          channels: ["email", "sse"],
          emailTemplate: "return-rejected",
          emailData: {
            customerName: customer.name ?? "there",
            orderId: returnRequest.orderId,
            reason: note,
            returnUrl: `${config.appUrl}/returns/${returnId}`,
          },
        })
        .catch(() => null);
    }

    return updated;
  },

  async getReturnRequest(returnId: string, sellerId: string) {
    const returnRequest = await db.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        order: {
          select: {
            id: true,
            displayId: true,
            type: true,
            totalAmount: true,
            sellerId: true,
            customer: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        shipment: true,
        images: { select: { id: true, url: true, fileType: true } },
      },
    });
    if (!returnRequest) throw new Error("Return request not found");

    if (returnRequest.order.sellerId !== sellerId) throw new Error("Return request not found");
    return returnRequest;
  },

  async listReturnRequests(
    sellerId: string,
    userId: string,
    filters: {
      status?: string;
      search?: string;
      reason?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const accessibleShopIds = await shopAccessService.getAccessibleShopIds(sellerId, userId);

    const where: any = { order: { sellerId } };
    if (accessibleShopIds !== null) {
      where.order.assignedShopId = { in: accessibleShopIds };
    }
    if (filters.status) where.status = filters.status;
    if (filters.reason)
      where.reason = { contains: filters.reason, mode: "insensitive" };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search, mode: "insensitive" } },
        {
          order: {
            displayId: { contains: filters.search, mode: "insensitive" },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      db.returnRequest.findMany({
        where,
        include: {
          shipment: {
            select: { trackingId: true, trackingUrl: true, status: true },
          },
          order: {
            select: {
              id: true,
              displayId: true,
              type: true,
              totalAmount: true,
              customer: { select: { id: true, name: true } },
            },
          },
          images: { select: { id: true, url: true, fileType: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.returnRequest.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async listAllReturnRequests(filters: {
    status?: string;
    search?: string;
    reason?: string;
    sellerId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const where: any = {};
    if (filters.sellerId) where.order = { sellerId: filters.sellerId };
    if (filters.status) where.status = filters.status;
    if (filters.reason)
      where.reason = { contains: filters.reason, mode: "insensitive" };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.search) {
      where.OR = [
        { id: { contains: filters.search, mode: "insensitive" } },
        {
          order: {
            displayId: { contains: filters.search, mode: "insensitive" },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      db.returnRequest.findMany({
        where,
        include: {
          shipment: {
            select: { trackingId: true, trackingUrl: true, status: true },
          },
          order: {
            select: {
              id: true,
              displayId: true,
              type: true,
              totalAmount: true,
              customer: { select: { id: true, name: true } },
              seller: { select: { id: true, name: true, businessName: true } },
            },
          },
          images: { select: { id: true, url: true, fileType: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.returnRequest.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  },

  async getReturnRequestForAdmin(returnId: string) {
    const returnRequest = await db.returnRequest.findUnique({
      where: { id: returnId },
      include: {
        shipment: true,
        images: { select: { id: true, url: true, fileType: true } },
        order: {
          select: {
            id: true,
            displayId: true,
            type: true,
            totalAmount: true,
            finalAmount: true,
            status: true,
            paymentStatus: true,
            customer: { select: { id: true, name: true, email: true } },
            seller: { select: { id: true, name: true, businessName: true, email: true } },
          },
        },
      },
    });
    if (!returnRequest) throw new Error("Return request not found");
    return returnRequest;
  },

  async listCustomerReturns(customerId: string) {
    return db.returnRequest.findMany({
      where: { customerId },
      select: {
        id: true,
        status: true,
        reason: true,
        createdAt: true,
        order: { select: { id: true, type: true, totalAmount: true } },
        shipment: {
          select: { trackingId: true, trackingUrl: true, status: true },
        },
        images: { select: { id: true, url: true, fileType: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async handleReversePickupWebhookEvent(event: WebhookEvent) {
    const shipment = await db.returnShipment.findFirst({
      where: { trackingId: event.trackingId },
    });
    if (!shipment) return { received: true };

    const mappedStatus = RETURN_STATUS_MAP[event.status.toLowerCase()];
    if (!mappedStatus || mappedStatus === shipment.status) return { received: true };

    const claimed = await db.returnShipment.updateMany({
      where: { id: shipment.id, status: { not: mappedStatus } },
      data: { status: mappedStatus },
    });
    if (claimed.count === 0) return { received: true };

    if (mappedStatus === "IN_TRANSIT") {
      await db.returnRequest.updateMany({
        where: { id: shipment.returnRequestId, status: "APPROVED" },
        data: { status: "PICKED_UP" },
      });
    }

    if (mappedStatus === "DELIVERED") {
      const completed = await db.returnRequest.updateMany({
        where: { id: shipment.returnRequestId, status: { in: ["APPROVED", "PICKED_UP"] } },
        data: { status: "COMPLETED" },
      });
      if (completed.count === 1) {
        const returnRequest = await db.returnRequest.findUnique({
          where: { id: shipment.returnRequestId },
          select: { orderId: true, customerId: true },
        });
        if (returnRequest) {
          try {
            await paymentService.initiateRefund(
              returnRequest.orderId,
              "system",
              "Return completed - item received back",
            );
          } catch (err: any) {
            logger.error(
              { err: err.message, orderId: returnRequest.orderId, returnRequestId: shipment.returnRequestId },
              "Failed to initiate refund after return marked COMPLETED",
            );
          }
        }
      }
    }

    if (mappedStatus === "FAILED") {
      logger.warn(
        { returnRequestId: shipment.returnRequestId, trackingId: event.trackingId },
        "Reverse pickup failed - return stuck, needs manual follow-up",
      );
    }

    return { received: true };
  },
};
