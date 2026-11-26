import { z } from "zod";
import { db } from "../../db/index";
import { getPlatformConfigNumber } from "../../lib/platform-config/platform-config";
import { walletService } from "../wallet/wallet.service";

export const NEGOTIATION_GATE_DEFAULTS = {
  FREE_SESSIONS: 3,
  VERIFIED_BONUS_SESSIONS: 2,
  FEE_CREDITS: 500,
};

export const LOCATION_RANGES = ["1", "2-10", "10-20", "20+"] as const;

export const negotiationIntentSchema = z
  .object({
    multipleLocations: z.boolean(),
    locationRange: z.enum(LOCATION_RANGES).optional(),
    locationCount: z.number().int().min(1).max(10000).optional(),
    customPackaging: z.boolean(),
    packagingDescription: z.string().trim().max(1000).optional(),
    remarks: z.string().trim().max(2000).optional(),
    confirmed: z.literal(true),
  })
  .refine((v) => !v.multipleLocations || !!v.locationRange, {
    message: "locationRange is required when multipleLocations is true",
    path: ["locationRange"],
  })
  .refine((v) => !v.customPackaging || !!v.packagingDescription, {
    message: "packagingDescription is required when customPackaging is true",
    path: ["packagingDescription"],
  });

export type NegotiationIntent = z.infer<typeof negotiationIntentSchema>;

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "rediffmail.com", "aol.com", "proton.me", "protonmail.com", "zoho.com",
]);

export async function isVerifiedBuyer(userId: string, orgId?: string | null): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, phoneVerifiedAt: true } });
  if (!user?.phoneVerifiedAt) return false;
  if (orgId) {
    const org = await db.customerOrg.findUnique({ where: { id: orgId }, select: { gstVerified: true } });
    if (org?.gstVerified) return true;
  }
  const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
  return !!domain && !FREE_MAIL_DOMAINS.has(domain);
}

export async function getNegotiationQuota(userId: string, orgId?: string | null) {
  const [free, bonus, fee, verified, used] = await Promise.all([
    getPlatformConfigNumber("NEGOTIATION_FREE_SESSIONS", NEGOTIATION_GATE_DEFAULTS.FREE_SESSIONS),
    getPlatformConfigNumber("NEGOTIATION_VERIFIED_BONUS", NEGOTIATION_GATE_DEFAULTS.VERIFIED_BONUS_SESSIONS),
    getPlatformConfigNumber("NEGOTIATION_FEE_CREDITS", NEGOTIATION_GATE_DEFAULTS.FEE_CREDITS),
    isVerifiedBuyer(userId, orgId),
    db.negotiationSession.count({ where: { customerId: userId } }),
  ]);
  const freeTotal = free + (verified ? bonus : 0);
  const freeRemaining = Math.max(0, freeTotal - used);
  return { verified, freeTotal, used, freeRemaining, feeCredits: freeRemaining > 0 ? 0 : fee };
}

export async function chargeNegotiationFee(userId: string, sessionId: string, feeCredits: number): Promise<number> {
  if (feeCredits <= 0) return 0;
  await walletService.getOrCreateWallet(userId);
  await walletService.debit(userId, feeCredits, "NEGOTIATION_FEE", sessionId);
  await db.negotiationSession.update({ where: { id: sessionId }, data: { creditsCharged: feeCredits } });
  return feeCredits;
}