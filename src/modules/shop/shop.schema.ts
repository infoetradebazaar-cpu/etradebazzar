import { z } from "zod";

export const createShopSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    description: z.string().optional(),
    category: z.string().min(2),
    logo: z.string().url().optional(),
    logoKey: z.string().optional(),
    banner: z.string().url().optional(),
    bannerKey: z.string().optional(),
    contactEmail: z.string().email(),
    contactPhone: z
      .string()
      .regex(/^(\+91)?[6-9]\d{9}$/, "Invalid phone number"),
    returnPolicy: z.string().optional(),
    pickupStreet: z.string().min(5),
    pickupCity: z.string().min(2).optional(),
    pickupState: z.string().min(2).optional(),
    pickupPincode: z.string().regex(/^\d{6}$/, "Invalid pincode"),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  }),
});

export const updateShopSchema = z.object({
  params: z.object({
    shopId: z.string(),
  }),
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    description: z.string().optional(),
    category: z.string().min(2).optional(),
    logo: z.string().url().optional(),
    logoKey: z.string().optional(),
    banner: z.string().url().optional(),
    bannerKey: z.string().optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z
      .string()
      .regex(/^(\+91)?[6-9]\d{9}$/, "Invalid phone number")
      .optional(),
    returnPolicy: z.string().optional(),
    pickupStreet: z.string().min(5).optional(),
    pickupCity: z.string().min(2).optional(),
    pickupState: z.string().min(2).optional(),
    pickupPincode: z
      .string()
      .regex(/^\d{6}$/, "Invalid pincode")
      .optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  }),
});

export const shopParamSchema = z.object({
  params: z.object({
    shopId: z.string(),
  }),
});

export const setAutoAssignSchema = z.object({
  params: z.object({ shopId: z.string() }),
  body: z.object({ enabled: z.boolean() }),
});
// export const reviewShopSchema = z.object({
//   params: z.object({
//     shopId: z.string(),
//   }),
//   body: z.object({
//     note: z.string().optional(),
//   }),
// });

// export const rejectShopSchema = z.object({
//   params: z.object({
//     shopId: z.string(),
//   }),
//   body: z.object({
//     reason: z.string().min(5),
//   }),
// });