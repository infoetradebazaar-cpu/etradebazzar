export interface CreateFundAccountInput {
    accountHolderName: string;
    accountNumber: string;// decipher
    ifscCode: string;
    bankName: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
}

export interface FundAccount {
    fundAccountId: string;
    raw: any;
}

export interface CreatePayoutInput {
    fundAccountId: string;
    amount: number;// in rupees
    currency: string;
    mode: "UPI" | "IMPS" | "RTGS" | "NEFT";
    refId: string; // our payoutId
    narration?: string;
}

export interface PayoutResult {
    razorpayPayoutId: string;
    status: "pending" | "processing" | "processed" | "failed" | "queued" | "cancelled";
    utrRef: string | null;
    raw: any;
}

export interface WebhookResult {
    razorpayPayoutId: string;
    referenceId: string | null;
    status: "processed" | "failed" | "queued" | "cancelled" | "processing";
    utrRef: string | null;
    failureReason: string | null;
    raw: any;
}

export interface PayoutProvider {
    createFundAccount(input: CreateFundAccountInput): Promise<FundAccount>;
    createPayout(input: CreatePayoutInput): Promise<PayoutResult>;
    getPayout(razorpayPayoutId: string): Promise<PayoutResult>;
    handleWebhook(payload: any, signature: string, webhookSecret: string): Promise<WebhookResult>;
}