import { GstProvider } from "./gst.interface";
import { SandboxGstInstance } from "./sandbox.provider";
import { SurepassGstInstance } from "./surepass.provider";
import { config } from "../../../config/config";

type GstProviderType = "sandbox" | "surepass";

class GstFactory {
    private static instances: Partial<Record<GstProviderType, GstProvider>> = {};

    static get(): GstProvider {
        const key = config.gstProvider as GstProviderType;

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: GstProviderType): GstProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxGstInstance(
                    config.sandboxGstApiKey,
                    config.sandboxGstApiSecret,
                );
            case "surepass":
                return new SurepassGstInstance(process.env["SUREPASS_GST_TOKEN"]!);
            default:
                throw new Error(`Unsupported GST provider: ${provider}`);
        }
    }
}

export { GstFactory };