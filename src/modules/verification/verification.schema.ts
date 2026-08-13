import { z } from "zod";

export const initializeDigilockerSchema = z.object({
    body: z.object({ redirectUrl: z.string().url().optional() }),
});

export const submitGovtIdSchema = z.object({
    body: z.object({
        govtIdType: z.enum(["PAN", "PASSPORT", "VOTER_ID", "DRIVING_LICENSE"]),
        govtIdNumber: z.string().min(4).max(30),
    }),
});

export const rejectVerificationSchema = z.object({
    params: z.object({ sellerId: z.string() }),
    body: z.object({ reason: z.string().min(5) }),
});

export const sellerParamSchema = z.object({
    params: z.object({ sellerId: z.string() }),
});

export const verifyPanSchema = z.object({
    body: z.object({
        panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN number format"),
    }),
});

export const verifyAadhaarSchema = z.object({
    body: z.object({
        aadhaarNumber: z.string().regex(/^\d{12}$/, "Aadhaar must be 12 digits"),
    }),
}); 