import { GstDetails, GstProvider } from "./gst.interface";

const BASE_URL = "https://api.sandbox.co.in";

export class SandboxGstInstance implements GstProvider {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${BASE_URL}/authenticate`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "x-api-secret": this.apiSecret,
        "x-api-version": "1.0",
      },
    });
    if (!res.ok) throw new Error("Sandbox GST auth failed");
    const data = (await res.json()) as any;
    return data.data.access_token;
  }
  async verifyGst(gstin: string): Promise<GstDetails> {
    const token = await this.getAccessToken();

    const res = await fetch(
      `${BASE_URL}/gst/compliance/public/gstin/search`,
      {
        method: "POST",
        headers: {
          Authorization: token,
          "x-api-key": this.apiKey,
          "x-api-version": "1.0",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gstin }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("Sandbox GST search failed", res.status, errBody);
      throw new Error(
        "GST verification failed  invalid GSTIN or service error",
      );
    }

    const payload = (await res.json()) as any;

    const result = payload.data?.data ?? payload.data;

    if (!result || !result.gstin) {
      throw new Error(
        "GST verification failed  invalid GSTIN or service error",
      );
    }
    return {
      gstin: result.gstin,
      legalName: result.lgnm,
      tradeName: result.tradeNam ?? result.lgnm,
      status: result.sts,
      address: result.pradr?.addr
        ? `${result.pradr.addr.bno ?? ""} ${result.pradr.addr.st ?? ""}, ${result.pradr.addr.loc ?? ""}, ${result.pradr.addr.stcd ?? ""} ${result.pradr.addr.pncd ?? ""}`.trim()
        : "",
      registrationDate: result.rgdt,
      businessType: result.ctb,
      raw: result,
    };
  }
}
