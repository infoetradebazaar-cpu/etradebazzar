import { AadhaarProvider } from "./aadhar.interface";
import { SandboxAadhaarInstance } from "./sanbox.provider";
import { SurepassAadhaarInstance } from "./surepass.provider";

type AadhaarProviderType = "sandbox" | "surepass";

class AadhaarFactory {
    private static instances: Partial<Record<AadhaarProviderType, AadhaarProvider>> = {};

    static get(): AadhaarProvider {
        const key = (process.env["AADHAAR_PROVIDER"] ?? "sandbox") as AadhaarProviderType;

        if (key === "sandbox" && process.env.NODE_ENV === "production") {
            throw new Error(
                "AADHAAR_PROVIDER=sandbox is not allowed when NODE_ENV=production this provider accepts a universal OTP and bypasses real Aadhaar verification"
            );
        }

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: AadhaarProviderType): AadhaarProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxAadhaarInstance(
                    process.env["SANDBOX_AADHAAR_API_KEY"]!,
                    process.env["SANDBOX_AADHAAR_API_SECRET"]!,
                );
            case "surepass":
                return new SurepassAadhaarInstance(process.env["SUREPASS_AADHAAR_TOKEN"]!);
            default:
                throw new Error(`Unsupported Aadhaar provider: ${provider}`);
        }
    }
}

export { AadhaarFactory };