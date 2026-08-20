import { BankVerificationProvider } from "./bank-verification.interface";
import { SandboxBankVerificationInstance } from "./sandbox.provider";
import { RazorpayXBankVerificationInstance } from "./razorpayx.provider";
import { SurepassBankVerificationInstance } from "./surepass.provider";
import { getPlatformConfig } from "../platform-config/platform-config";
import { config } from "../../../config/config";

type BankVerificationProviderType = "sandbox" | "razorpayx" | "surepass";

class BankVerificationFactory {
    private static sandboxInstance: BankVerificationProvider | null = null;

    static async get(): Promise<BankVerificationProvider> {
        const key = config.bankVerificationProvider as BankVerificationProviderType;

        return this.create(key);
    }

    private static async create(provider: BankVerificationProviderType): Promise<BankVerificationProvider> {
        switch (provider) {
            case "sandbox":
                if (!this.sandboxInstance) {
                    this.sandboxInstance = new SandboxBankVerificationInstance(
                        config.sandboxBankVerificationApiKey,
                        config.sandboxBankVerificationApiSecret,
                    );
                }
                return this.sandboxInstance;
            case "razorpayx": {
                const [keyId, keySecret, sourceAccountNumber] = await Promise.all([
                    getPlatformConfig("razorpay_key_id"),
                    getPlatformConfig("razorpay_key_secret"),
                    getPlatformConfig("razorpay_account_number"),
                ]);
                return new RazorpayXBankVerificationInstance(keyId, keySecret, sourceAccountNumber);
            }
            case "surepass":
                return new SurepassBankVerificationInstance(process.env["SUREPASS_BANK_VERIFICATION_TOKEN"]!);
            default:
                throw new Error(`Unsupported bank verification provider: ${provider}`);
        }
    }
}

export { BankVerificationFactory };
