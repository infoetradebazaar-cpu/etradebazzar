import { PanProvider } from "./pan.interface";
import { SandboxPanInstance } from "./sanbox.provider";
import { SurepassPanInstance } from "./surepass.provider";
import { config } from "../../../config/config";


type PanProviderType = "sandbox" | "surepass";

class PanFactory {
    private static instances: Partial<Record<PanProviderType, PanProvider>> = {};

    static get(): PanProvider {
        const key = config.panProvider as PanProviderType;

        if (!this.instances[key]) {
            this.instances[key] = this.create(key);
        }

        return this.instances[key]!;
    }

    private static create(provider: PanProviderType): PanProvider {
        switch (provider) {
            case "sandbox":
                return new SandboxPanInstance(
                    config.sandboxPanApiKey,
                    config.sandboxPanApiSecret,
                );
            case "surepass":
                return new SurepassPanInstance(process.env["SUREPASS_PAN_TOKEN"]!);
            default:
                throw new Error(`Unsupported PAN provider: ${provider}`);
        }
    }
}

export { PanFactory };