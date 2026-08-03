import { z } from "zod";

const orderItemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
});

export const createOrderSchema = z.object({
    body: z.object({
        idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID"),
        sellerId: z.string(),
        type: z.enum(["STANDARD", "SAMPLE"]),
        items: z.array(orderItemSchema).min(1),
        deliveryAddress: z.object({
            receiverName: z.string().min(2),
            phone: z.string().regex(/^\+?[6-9]\d{9}$/, "Invalid phone"),
            street: z.string().min(5),
            city: z.string().min(2),
            state: z.string().min(2),
            pincode: z.string().regex(/^\d{6}$/, "Invalid pincode"),
            latitude: z.number().optional(),
            longitude: z.number().optional(),
        }),
    }),
});

export const createBulkOrderSchema = z.object({
    body: z.object({
        idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID"),
        sellerId: z.string(),
        items: z.array(orderItemSchema).min(1),
    }),
});

export const submitProposalSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
    body: z.object({
        proposedPrice: z.number().positive(),
        note: z.string().optional(),
        meetLink: z.string().url().optional(),
    }),
});

export const respondProposalSchema = z.object({
    params: z.object({
        orderId: z.string(),
        negotiationId: z.string(),
    }),
    body: z.object({
        action: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
        counterPrice: z.number().positive().optional(),
        note: z.string().optional(),
    }),
});

export const confirmOrderSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
});

export const assignShopSchema = z.object({
    params: z.object({
        orderId: z.string(),
        addressId: z.string(),
    }),
    body: z.object({
        shopId: z.string(),
    }),
});

export const orderParamSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
});

export const bulkUploadSchema = z.object({
    params: z.object({
        orderId: z.string(),
    }),
});

export const setThresholdSchema = z.object({
    body: z.object({
        productCategory: z.string().optional(),
        amount: z.number().positive(),
    }),
});

export const setCommissionSchema = z.object({
    body: z.object({
        productId: z.string().optional(),
        category: z.string().optional(),
        rate: z.number().min(0).max(100),
    }),
});

export const bulkOrderActionSchema = z.object({
    body: z.object({
        orderIds: z.array(z.string()).min(1),
        action: z.enum(["confirm", "cancel", "ship"]),
    }),
});

export const bulkRespondNegotiationsSchema = z.object({
    body: z.object({
        orderIds: z.array(z.string()).min(1),
        action: z.enum(["ACCEPT", "REJECT"]),
        counterPrice: z.number().positive().optional(),
        note: z.string().optional(),
    }),
});

export const listAllOrdersSchema = z.object({
    query: z.object({
        status: z.string().optional(),
        search: z.string().optional(),
        type: z.string().optional(),
        sellerId: z.string().optional(),
        shopId: z.string().optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
    }),
});

export const markPackedSchema = z.object({
    params: z.object({ orderId: z.string() }),
});

export const cancelOrderSchema = z.object({
    params: z.object({ orderId: z.string() }),
    body: z.object({
        reason: z.string().max(500).optional(),
    }).optional(),
});