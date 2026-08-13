import { PanProvider, PanDetails } from "./pan.interface";
import { logger } from "../../utils/logger";
import { fetchWithTimeout } from "../http/fetch-with-timeout";
import { VerificationRejectedError } from "../verification/verification-errors";

const PAN_ENDPOINT = "https://sandbox.surepass.app/api/v1/pan/pan-comprehensive";
const PAN_TIMEOUT_MS = 4000;

export class SurepassPanInstance implements PanProvider {
    private token: string;

    constructor(token: string) {
        this.token = token;
    }

    async verifyPan(panNumber: string): Promise<PanDetails> {
        const res = await fetchWithTimeout(
            PAN_ENDPOINT,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ id_number: panNumber, masked_aadhaar_variant: "v1, v2, empty" }),
            },
            PAN_TIMEOUT_MS,
        );

        if (!res.ok && res.status !== 422) {
            const errorBody = await res.text().catch(() => null);
            logger.error(
                { status: res.status, statusText: res.statusText, body: errorBody },
                "Surepass PAN verification API returned non-OK status",
            );
            throw new Error(`PAN verification failed (HTTP ${res.status}): ${errorBody ?? res.statusText}`);
        }

        const data = (await res.json()) as any;
        const result = data.data;

        if (!result || !result.pan_number)
            throw new Error("PAN verification failed - invalid PAN or service error");

        if (result.status === "invalid" || data.success === false)
            throw new VerificationRejectedError(data.message || "PAN verification failed invalid PAN number");

        return {
            panNumber: result.pan_number,
            fullName: result.full_name ?? "",
            category: result.category,
            status: "VALID",
            aadhaarSeedingStatus: result.aadhaar_linked ? "LINKED" : "NOT_LINKED",
            raw: result,
        };
    }
}