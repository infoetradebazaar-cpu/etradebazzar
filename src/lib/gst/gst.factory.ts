import { GstProvider } from "./gst.interface";
import { SandboxGstInstance } from "./sandbox.provider";
import { SurepassGstInstance } from "./surepass.provider";

type GstProviderType = "sandbox" | "surepass";

class GstFactory {
    private static instances: Partial<Record<GstProviderType, GstProvider>> = {};

    static get(): GstProvider {
        const key = (process.env["GST_PROVIDER"] ?? "sandbox") as GstProviderType;
        if (key === "sandbox" && process.env.NODE_ENV === "production") {
            throw new Error(
                "GST_PROVIDER=sandbox is not allowed when NODE_ENV=production - confirm the real provider is configured"
            );
        }

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: GstProviderType): GstProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxGstInstance(
                    process.env["SANDBOX_GST_API_KEY"]!,
                    process.env["SANDBOX_GST_API_SECRET"]!
                );
            case "surepass":
                return new SurepassGstInstance(process.env["SUREPASS_GST_TOKEN"]!);
            default:
                throw new Error(`Unsupported GST provider: ${provider}`);
        }
    }
}

export { GstFactory };