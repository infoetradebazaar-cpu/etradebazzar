import { z } from "zod";
import { strongPasswordSchema } from "../../utils/password-policy";

const addressSchema = z.object({
  street: z.string().min(5),
  city: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  pincode: z.string().regex(/^\d{6}$/, "Invalid pincode"),
});

export const registerSellerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: strongPasswordSchema,
    phone: z.string().regex(/^\+?[6-9]\d{9}$/, "Invalid phone number"),
    businessName: z.string().min(2).max(100),
    businessType: z.enum(["INDIVIDUAL", "COMPANY", "PARTNERSHIP"]),
    address: addressSchema,
    gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Invalid GSTIN format").optional(),
    pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format").optional(),
  }),
});

export const completeSellerKycSchema = z.object({
  body: z.object({
    aadharNumber: z.string().regex(/^\d{12}$/, "Invalid Aadhar number"),
    panNumber: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN number"),
    gstNumber: z
      .string()
      .regex(
        /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/,
        "Invalid GST number",
      )
      .optional(),
    businessRegNumber: z.string().optional(),
    documents: z.array(z.string()).optional(),
    govtIdType: z.string().optional(),
    govtIdNumber: z.string().optional(),
  }),
});

export const addBankDetailSchema = z.object({
  body: z.object({
    accountHolderName: z.string().min(2),
    accountNumber: z.string().regex(/^\d{9,18}$/, "Invalid account number"),
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"),
    bankName: z.string().min(2).optional(),
  }),
});

export const updateBankDetailSchema = z.object({
  body: z.object({
    accountHolderName: z.string().min(2).optional(),
    accountNumber: z.string().regex(/^\d{9,18}$/, "Invalid account number").optional(),
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code").optional(),
    bankName: z.string().min(2).optional(),
  }),
});

export const verifyIfscSchema = z.object({
  body: z.object({
    ifscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"),
  }),
});

export const bankReverifySchema = z.object({
  params: z.object({ sellerId: z.string() }),
});

export const bankOverrideSchema = z.object({
  params: z.object({ sellerId: z.string() }),
  body: z.object({
    verificationStatus: z.enum(["VERIFIED", "NAME_MISMATCH", "FAILED"]),
    reason: z.string().min(5),
  }),
});

export const gstPanReverifySchema = z.object({
  params: z.object({ sellerId: z.string() }),
});

export const gstPanOverrideSchema = z.object({
  params: z.object({ sellerId: z.string() }),
  body: z.object({
    field: z.enum(["gst", "pan"]),
    status: z.enum(["VERIFIED", "FAILED"]),
    reason: z.string().min(5),
  }),
});

export const inviteSellerSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const acceptInviteSchema = z.object({
  body: z.object({
    token: z.string(),
    name: z.string().min(2).max(100),
    password: strongPasswordSchema,
    phone: z.string().regex(/^\+?[6-9]\d{9}$/, "Invalid phone number"),
    businessName: z.string().min(2).max(100),
    businessType: z.enum(["INDIVIDUAL", "COMPANY", "PARTNERSHIP"]),
    address: addressSchema,
  }),
});

export const approveSellerSchema = z.object({
  params: z.object({
    sellerId: z.string(),
  }),
});

export const rejectSellerSchema = z.object({
  params: z.object({
    sellerId: z.string(),
  }),
  body: z.object({
    reason: z.string().min(5),
  }),
});

export const suspendSellerSchema = z.object({
  params: z.object({
    sellerId: z.string(),
  }),
  body: z.object({
    reason: z.string().min(5),
  }),
});

export const addMemberSchema = z.object({
  body: z.object({
    email: z.string().email(),
    roleId: z.string(),
  }),
});

export const updateMemberRoleSchema = z.object({
  params: z.object({
    memberId: z.string(),
  }),
  body: z.object({
    roleId: z.string(),
  }),
});

export const kycActionSchema = z.object({
  params: z.object({ sellerId: z.string() }),
});

export const rejectKycSchema = z.object({
  params: z.object({ sellerId: z.string() }),
  body: z.object({ reason: z.string().min(5) }),
});

export const inviteMemberSchema = z.object({
  body: z.object({
    email: z.string().email(),
    roleId: z.string(),
    name: z.string().optional(),
  }),
});

export const removeMemberSchema = z.object({
  params: z.object({ memberId: z.string() }),
});

export const createRoleSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(30),
    description: z.string().optional(),
  }),
});
export const updateRoleSchema = z.object({
  params: z.object({ roleId: z.string() }),
  body: z.object({
    name: z.string().min(2).max(30).optional(),
    description: z.string().optional(),
  }),
});
export const roleParamSchema = z.object({
  params: z.object({ roleId: z.string() }),
});
export const inviteParamSchema = z.object({
  params: z.object({ inviteId: z.string() }),
});
export const resendInviteSchema = z.object({
  body: z.object({ inviteId: z.string() }),
});
export const acceptTeamInviteSchema = z.object({
  body: z.object({
    token: z.string(),
    name: z.string().min(2),
    password: strongPasswordSchema,
  }),
});
