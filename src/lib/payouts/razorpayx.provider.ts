import crypto from 'crypto';
import { CreateFundAccountInput, CreatePayoutInput, FundAccount, PayoutProvider, PayoutResult, WebhookResult } from './payout.interface';

const BASE_URL = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;

const STATUS_MAP: Record<string, PayoutResult["status"]> = {
    pending: "pending",
    processing: "processing",
    processed: "processed",
    failed: "failed",
    queued: "queued",
    cancelled: "cancelled",
};

function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export class RazorpayXInstance implements PayoutProvider {
    private keyId: string;
    private keySecret: string;

    private sourceAccountNumber: string;

    constructor(keyId: string, keySecret: string, sourceAccountNumber: string) {
        this.keyId = keyId;
        this.keySecret = keySecret;
        this.sourceAccountNumber = sourceAccountNumber;
    }

    private get authHeader(): string {
        const token = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
        return `Basic ${token}`;
    }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {},
        accountNumber?: string
    ): Promise<T> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: this.authHeader,
        };

        //X-Razorpay-Account header payout APIs
        if (accountNumber) {
            headers["X-Razorpay-Account"] = accountNumber;
        }

        const res = await fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => null) as any;
            const err: Error & { httpStatus?: number } = new Error(
                `RazorpayX error: ${error?.error?.description ?? res.statusText}`,
            );
            err.httpStatus = res.status;
            throw err;
        }

        return res.json() as Promise<T>;
    }

    async createFundAccount(input: CreateFundAccountInput): Promise<FundAccount> {
        const contact = await this.request<any>("/contacts", {
            method: "POST",
            body: JSON.stringify({
                name: input.contactName,
                email: input.contactEmail,
                contact: input.contactPhone,
                type: "vendor",
            }),
        });

        const fundAccount = await this.request<any>("/fund_accounts", {
            method: "POST",
            body: JSON.stringify({
                contact_id: contact.id,
                account_type: "bank_account",
                bank_account: {
                    name: input.accountHolderName,
                    ifsc: input.ifscCode,
                    account_number: input.accountNumber,
                },
            }),
        });

        return {
            fundAccountId: fundAccount.id,
            raw: fundAccount,
        };
    }

    async createPayout(input: CreatePayoutInput): Promise<PayoutResult> {
        const payout = await this.request<any>("/payouts", {
            method: "POST",
            headers: { "X-Payout-Idempotency": input.refId },
            body: JSON.stringify({
                account_number: this.sourceAccountNumber,
                fund_account_id: input.fundAccountId,
                amount: Math.round(input.amount * 100), // paise
                currency: input.currency,
                mode: input.mode,
                purpose: "payout",
                reference_id: input.refId,
                narration: input.narration ?? "Seller payout",
                queue_if_low_balance: true,
            }),
        });

        return {
            razorpayPayoutId: payout.id,
            status: STATUS_MAP[payout.status] ?? "pending",
            utrRef: payout.utr ?? null,
            raw: payout,
        };
    }


    async validateFundAccount(
        fundAccountId: string,
        amountPaise = 100,
    ): Promise<{
        validationId: string;
        status: "created" | "completed" | "failed";
        accountStatus: "active" | "inactive" | null;
        registeredName: string | null;
        raw: any;
    }> {
        let validation = await this.request<any>("/fund_accounts/validations", {
            method: "POST",
            body: JSON.stringify({
                account_number: this.sourceAccountNumber,
                fund_account: { id: fundAccountId },
                amount: amountPaise,
                currency: "INR",
            }),
        });

        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts && validation.status === "created"; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            validation = await this.request<any>(`/fund_accounts/validations/${validation.id}`);
        }

        return {
            validationId: validation.id,
            status: validation.status,
            accountStatus: validation.results?.account_status ?? null,
            registeredName: validation.results?.registered_name ?? null,
            raw: validation,
        };
    }

    async deactivateFundAccount(fundAccountId: string): Promise<void> {
        await this.request(`/fund_accounts/${fundAccountId}`, {
            method: "PATCH",
            body: JSON.stringify({ active: false }),
        });
    }

    async getPayout(razorpayPayoutId: string): Promise<PayoutResult> {
        const payout = await this.request<any>(`/payouts/${razorpayPayoutId}`);

        return {
            razorpayPayoutId: payout.id,
            status: STATUS_MAP[payout.status] ?? "pending",
            utrRef: payout.utr ?? null,
            raw: payout,
        };
    }

    async handleWebhook(payload: Buffer | string, signature: string, webhookSecret: string): Promise<WebhookResult> {
        const rawBody = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;

        const expected = crypto
            .createHmac("sha256", webhookSecret)
            .update(rawBody)
            .digest("hex");

        if (!timingSafeEqualStr(expected, signature)) {
            throw new Error("Invalid webhook signature");
        }

        const parsedPayload = JSON.parse(rawBody);

        const event = parsedPayload.event as string;
        const entity = parsedPayload.payload?.payout?.entity;

        if (!entity) throw new Error("Invalid webhook payload");

        const statusMap: Record<string, WebhookResult["status"]> = {
            "payout.processed": "processed",
            "payout.failed": "failed",
            "payout.queued": "queued",
            "payout.cancelled": "cancelled",
            "payout.reversed": "failed",
            "payout.rejected": "failed",
        };

        return {
            razorpayPayoutId: entity.id,
            referenceId: entity.reference_id ?? null,
            status: statusMap[event] ?? "processing",
            utrRef: entity.utr ?? null,
            failureReason: entity.error?.description ?? null,
            raw: parsedPayload,
        };
    }
}