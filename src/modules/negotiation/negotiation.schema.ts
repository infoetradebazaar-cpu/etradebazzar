import { z } from "zod";

const deliveryAddressSchema = z.object({
  receiverName: z.string().min(1),
  phone: z.string().min(1),
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

export const startAutoNegotiationSchema = z.object({
  body: z.object({
    sellerId: z.string(),
    productId: z.string(),
    skuId: z.string(),
    quantity: z.number().int().positive(),
    customerPrice: z.number().positive().optional(),
  }),
});

export const negotiationSessionParamSchema = z.object({
  params: z.object({ sessionId: z.string() }),
});

export const respondAutoNegotiationSchema = z.object({
  params: z.object({ sessionId: z.string() }),
  body: z.object({
    action: z.enum(["ACCEPT", "REJECT"]),
    deliveryAddress: deliveryAddressSchema.optional(),
    customerPrice: z.number().positive().optional(),
  }),
});

export const startManualNegotiationSchema = z.object({
  body: z.object({
    sellerId: z.string(),
    productId: z.string(),
    skuId: z.string(),
    quantity: z.number().int().positive(),
  }),
});

export const proposeTimeSlotSchema = z.object({
  params: z.object({ sessionId: z.string() }),
  body: z.object({ timeSlot: z.string().datetime() }),
});

export const confirmTimeSlotSchema = z.object({
  params: z.object({ sessionId: z.string() }),
});

export const sendMessageSchema = z.object({
  params: z.object({ sessionId: z.string() }),
  body: z.object({ body: z.string().min(1).max(2000) }),
});

export const manualAcceptSchema = z.object({
  params: z.object({ sessionId: z.string() }),
  body: z.object({
    finalPrice: z.number().positive(),
    deliveryAddress: deliveryAddressSchema,
  }),
});
