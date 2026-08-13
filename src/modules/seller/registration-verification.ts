import { GstFactory } from "../../lib/gst/gst.factory";
import { PanFactory } from "../../lib/pan/pan.factory";
import { logger } from "../../utils/logger";

export interface RegistrationVerificationResult {
  status: "VERIFIED" | "FAILED" | "UNVERIFIED";
  verifiedName: string | null;
  raw: unknown;
  failureReason: string | null;
}

function classifyError(error: any): { status: "FAILED" | "UNVERIFIED"; failureReason: string } {
  if (error?.name === "VerificationRejectedError") {
    return { status: "FAILED", failureReason: error.message };
  }
  return { status: "UNVERIFIED", failureReason: error?.message ?? "Verification service unavailable" };
}

export async function verifyGstAtRegistration(gstin: string): Promise<RegistrationVerificationResult> {
  try {
    const provider = GstFactory.get();
    const details = await provider.verifyGst(gstin);
    const isActive = (details.status ?? "").toLowerCase() === "active";

    return {
      status: isActive ? "VERIFIED" : "FAILED",
      verifiedName: details.legalName ?? null,
      raw: details.raw,
      failureReason: isActive ? null : `GST registration status is ${details.status}`,
    };
  } catch (error: any) {
    logger.warn({ err: error.message, name: error.name }, "GST verification at registration failed");
    const { status, failureReason } = classifyError(error);
    return { status, verifiedName: null, raw: null, failureReason };
  }
}

export async function verifyPanAtRegistration(pan: string): Promise<RegistrationVerificationResult> {
  try {
    const provider = PanFactory.get();
    const details = await provider.verifyPan(pan);
    const isValid = (details.status ?? "").toUpperCase() === "VALID";

    return {
      status: isValid ? "VERIFIED" : "FAILED",
      verifiedName: isValid ? details.fullName || null : null,
      raw: details.raw,
      failureReason: isValid ? null : `PAN status is ${details.status}`,
    };
  } catch (error: any) {
    logger.warn({ err: error.message, name: error.name }, "PAN verification at registration failed");
    const { status, failureReason } = classifyError(error);
    return { status, verifiedName: null, raw: null, failureReason };
  }
}
