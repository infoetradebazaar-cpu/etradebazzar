import { z } from "zod";
import { strongPasswordSchema } from "../../utils/password-policy";

export const registerCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: strongPasswordSchema,
    phone: z.string().min(10).max(15),
    address: z.object({
      street: z.string().min(3),
      city: z.string().min(2),
      state: z.string().min(2),
      pincode: z.string().min(6).max(10),
    }),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({ name: z.string().min(2).max(100).optional() }),
});

export const phoneLinkRequestSchema = z.object({
  body: z.object({ phone: z.string().min(10).max(15) }),
});

export const phoneLinkVerifySchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15),
    otp: z.string().length(6),
  }),
});

export const listMyOrdersSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  }),
});
