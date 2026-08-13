import { BankVerificationProvider, BankAccountVerificationInput, BankAccountVerificationResult } from "./bank-verification.interface";
import { computeNameMatchScore, NAME_MATCH_THRESHOLD } from "./name-match";

const BANK_VERIFICATION_ENDPOINT = "https://sandbox.surepass.app/api/v1/bank-verification";


export class SurepassBankVerificationInstance implements BankVerificationProvider {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    async verifyBankAccount(input: BankAccountVerificationInput): Promise<BankAccountVerificationResult> {
        const res = await fetch(BANK_VERIFICATION_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.token}`,
            },
            body: JSON.stringify({
                id_number: input.accountNumber,
                ifsc: input.ifscCode,
                ifsc_details: true,
            }),
        });

        // Surepass returns 422 - not 200 - for a legitimate "account does not
        const body = await res.json().catch(() => null) as any;
        const result = body?.data;

        if (!result) {
            return {
                outcome: "FAILED",
                accountStatus: null,
                verifiedAccountHolderName: null,
                nameMatchScore: null,
                fundAccountId: null,
                failureReason: body?.message || "Bank verification failed invalid account or service error",
                raw: body,
            };
        }

        if (!result.account_exists) {
            return {
                outcome: "FAILED",
                accountStatus: "inactive",
                verifiedAccountHolderName: null,
                nameMatchScore: null,
                fundAccountId: null,
                failureReason: result.remarks || "Account does not exist or is inactive",
                raw: result,
            };
        }

        const registeredName = result.full_name ?? "";
        const score = computeNameMatchScore(input.accountHolderName, registeredName);

        return {
            outcome: score >= NAME_MATCH_THRESHOLD ? "VERIFIED" : "NAME_MISMATCH",
            accountStatus: "active",
            verifiedAccountHolderName: registeredName,
            nameMatchScore: score,
            fundAccountId: null,
            failureReason: null,
            raw: result,
        };
    }

    async deactivateFundAccount(_fundAccountId: string): Promise<void> {
        // Surepass bank verification has no fund-account concept - nothing to deactivate.
    }
}