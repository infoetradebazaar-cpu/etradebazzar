import { AadhaarProvider } from "./aadhar.interface";
import { SandboxAadhaarInstance } from "./sanbox.provider";
import { SurepassAadhaarInstance } from "./surepass.provider";
import { config } from "../../../config/config";

type AadhaarProviderType = "sandbox" | "surepass";

class AadhaarFactory {
    private static instances: Partial<Record<AadhaarProviderType, AadhaarProvider>> = {};

    static get(): AadhaarProvider {
        const key = config.aadhaarProvider as AadhaarProviderType;

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: AadhaarProviderType): AadhaarProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxAadhaarInstance(
                    config.sandboxAadhaarApiKey,
                    config.sandboxAadhaarApiSecret,
                );
            case "surepass":
                return new SurepassAadhaarInstance(process.env["SUREPASS_AADHAAR_TOKEN"]!);
            default:
                throw new Error(`Unsupported Aadhaar provider: ${provider}`);
        }
    }
}

export { AadhaarFactory };