import { BankVerificationProvider } from "./bank-verification.interface";
import { SandboxBankVerificationInstance } from "./sandbox.provider";
import { RazorpayXBankVerificationInstance } from "./razorpayx.provider";
import { SurepassBankVerificationInstance } from "./surepass.provider";
import { getPlatformConfig } from "../platform-config/platform-config";

type BankVerificationProviderType = "sandbox" | "razorpayx" | "surepass";

class BankVerificationFactory {
    private static sandboxInstance: BankVerificationProvider | null = null;

    // RazorpayX credentials live in the encrypted platformConfig table (same
    // source payout.service.ts reads from), not env vars - that's what lets a
    // verified fundAccountId be reused for the actual payout later, since both
    // must be created under the same RazorpayX account. That's why this get()
    // is async, unlike the sync GST/PAN/Aadhaar factories.
    static async get(): Promise<BankVerificationProvider> {
        const key = (process.env["BANK_VERIFICATION_PROVIDER"] ?? "sandbox") as BankVerificationProviderType;

        if (key === "sandbox" && process.env.NODE_ENV === "production") {
            throw new Error(
                "BANK_VERIFICATION_PROVIDER=sandbox is not allowed when NODE_ENV=production this provider never contacts a real bank and always returns a deterministic fake verification result"
            );
        }

        return this.create(key);
    }

    private static async create(provider: BankVerificationProviderType): Promise<BankVerificationProvider> {
        switch (provider) {
            case "sandbox":
                if (!this.sandboxInstance) {
                    this.sandboxInstance = new SandboxBankVerificationInstance(
                        process.env["SANDBOX_BANK_VERIFICATION_API_KEY"]!,
                        process.env["SANDBOX_BANK_VERIFICATION_API_SECRET"]!,
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
