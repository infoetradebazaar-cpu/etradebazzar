import { PanProvider } from "./pan.interface";
import { SandboxPanInstance } from "./sanbox.provider";
import { SurepassPanInstance } from "./surepass.provider";


type PanProviderType = "sandbox" | "surepass";

class PanFactory {
    private static instances: Partial<Record<PanProviderType, PanProvider>> = {};

    static get(): PanProvider {
        const key = (process.env["PAN_PROVIDER"] ?? "sandbox") as PanProviderType;

        if (key === "sandbox" && process.env.NODE_ENV === "production") {
            throw new Error(
                "PAN_PROVIDER=sandbox is not allowed when NODE_ENV=production this provider validates PAN format only and never calls a real verification service"
            );
        }

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: PanProviderType): PanProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxPanInstance(
                    process.env["SANDBOX_PAN_API_KEY"]!,
                    process.env["SANDBOX_PAN_API_SECRET"]!,
                );
            case "surepass":
                return new SurepassPanInstance(process.env["SUREPASS_PAN_TOKEN"]!);
            default:
                throw new Error(`Unsupported PAN provider: ${provider}`);
        }
    }
}

export { PanFactory };