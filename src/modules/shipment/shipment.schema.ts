import { z } from "zod";

export const shipmentParamSchema = z.object({
    params: z.object({ shipmentId: z.string() }),
});

export const serviceabilitySchema = z.object({
    query: z.object({
        pickupPincode: z.string().regex(/^\d{6}$/, "Invalid pickup pincode"),
        deliveryPincode: z.string().regex(/^\d{6}$/, "Invalid delivery pincode"),
        weightKg: z.string().regex(/^\d+(\.\d+)?$/, "Invalid weightKg"),
        cod: z.enum(["true", "false"]).optional(),
    }),
});

export const bulkCancelShipmentsSchema = z.object({
    body: z.object({ shipmentIds: z.array(z.string()).min(1).max(100) }),
});

export const listAllShipmentsSchema = z.object({
    query: z.object({
        status: z.string().optional(),
        search: z.string().optional(),
        sellerId: z.string().optional(),
        shopId: z.string().optional(),
        courierPartner: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        page: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
    }),
});