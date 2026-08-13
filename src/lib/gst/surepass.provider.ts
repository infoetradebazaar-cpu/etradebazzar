import { GstProvider, GstDetails } from "./gst.interface";
import { fetchWithTimeout } from "../http/fetch-with-timeout";
import { VerificationRejectedError } from "../verification/verification-errors";
import { logger } from "../../utils/logger";

const GST_ENDPOINT = "https://sandbox.surepass.app/api/v1/corporate/gstin";
const GST_TIMEOUT_MS = 4000;

export class SurepassGstInstance implements GstProvider {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async verifyGst(gstin: string): Promise<GstDetails> {
    const res = await fetchWithTimeout(
      GST_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ id_number: gstin }),
      },
      GST_TIMEOUT_MS,
    );

    // Surepass returns 422 - not 200 - for a legitimate "GSTIN doesn't
    // exist/match" result
    const data = await res.json().catch(() => null) as any;
    const result = data?.data;

    if (!res.ok || !result || !result.gstin) {
      if (data?.success === false && res.status === 422) {
        throw new VerificationRejectedError(data.message || "Invalid GSTIN");
      }
      logger.error(
        { status: res.status, body: data },
        "Surepass GST verification API returned an unexpected response",
      );
      throw new Error("GST verification failed service error");
    }

    return {
      gstin: result.gstin,
      legalName: result.legal_name,
      tradeName: result.business_name ?? result.legal_name,
      status: result.gstin_status,
      address: result.address ?? "",
      registrationDate: result.date_of_registration,
      businessType: result.constitution_of_business,
      raw: result,
    };
  }
}
