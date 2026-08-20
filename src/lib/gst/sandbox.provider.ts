import { GstDetails, GstProvider } from "./gst.interface";

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class SandboxGstInstance implements GstProvider {
  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  async verifyGst(gstin: string): Promise<GstDetails> {
    const isWellFormed = GSTIN_REGEX.test(gstin);

    if (!isWellFormed) {
      throw new Error("GST verification failed  invalid GSTIN format");
    }

    return {
      gstin,
      legalName: "SANDBOX TEST PRIVATE LIMITED",
      tradeName: "SANDBOX TEST ENTERPRISE",
      status: "Active",
      address: "Sandbox Address, Test City, Test State, 000000",
      registrationDate: "2020-01-01",
      businessType: "Private Limited Company",
      raw: { sandbox: true, apiKey: this.apiKey ? "set" : "unset" },
    };
  }
}
