import { config } from "../../../config/config";
import { logger } from "../../utils/logger";
import type {
    ShipmentProvider,
    CreateShipmentInput,
    ShipmentResult,
    TrackingResult,
    ServiceabilityResult,
    WebhookEvent,
} from "./shipment.interface";
import crypto from "crypto";

function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

export class ShiprocketInstance implements ShipmentProvider {
    private token: string | null = null;
    private tokenExpiry: Date | null = null;
    private baseUrl = config.shiprocketBaseUrl;
    private tokenRefreshPromise: Promise<string> | null = null;

    private async getToken(): Promise<string> {
        if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
            return this.token;
        }

        if (this.tokenRefreshPromise) {
            return this.tokenRefreshPromise;
        }

        this.tokenRefreshPromise = (async () => {
            try {
                const res = await fetch(`${this.baseUrl}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: config.shiprocketEmail,
                        password: config.shiprocketPassword,
                    }),
                });
                if (!res.ok) throw new Error("Shiprocket auth failed");
                const data = (await res.json()) as { token: string };
                this.token = data.token;
                this.tokenExpiry = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
                logger.info("Shiprocket token refreshed");
                return this.token;
            } finally {
                this.tokenRefreshPromise = null;
            }
        })();

        return this.tokenRefreshPromise;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const token = await this.getToken();
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...options.headers,
            },
        });
        if (!res.ok) {
            const error = await res.text();
            throw new Error(`Shiprocket API error: ${error}`);
        }
        return res.json() as Promise<T>;
    }

    async createShipment(input: CreateShipmentInput): Promise<ShipmentResult> {
        const response = await this.request<any>("/orders/create/adhoc", {
            method: "POST",
            body: JSON.stringify({
                order_id: input.orderId,
                order_date: new Date().toISOString().split("T")[0],
                pickup_location: input.pickupLocation,
                billing_customer_name: input.receiverName,
                billing_address: input.address,
                billing_city: input.city,
                billing_pincode: input.pincode,
                billing_state: input.state,
                billing_country: input.country,
                billing_email: input.email,
                billing_phone: input.phone,
                shipping_is_billing: true,
                payment_method: input.paymentMethod,
                sub_total: input.subTotal,
                length: input.length,
                breadth: input.breadth,
                height: input.height,
                weight: input.weight,
                order_items: input.items.map((i) => ({
                    name: i.name,
                    sku: i.sku,
                    units: i.units,
                    selling_price: i.sellingPrice,
                    weight: i.weight,
                })),
            }),
        });
        let trackingId: string | null = response?.payload?.awb_code ?? response?.awb_code ?? null;
        let courierName: string | null = null;
        let assignRaw: any = null;
        const shipmentId = response?.shipment_id ?? response?.payload?.shipment_id;
        if (!trackingId && shipmentId) {
            assignRaw = await this.request<any>("/courier/assign/awb", {
                method: "POST",
                body: JSON.stringify({
                    shipment_id: shipmentId,
                    ...(input.courierId ? { courier_id: input.courierId } : {}),
                }),
            });
            const data = assignRaw?.response?.data;
            trackingId = data?.awb_code || null;
            courierName = data?.courier_name ?? null;
        }
        return {
            trackingId,
            courierName,
            trackingUrl: trackingId ? `https://shiprocket.co/tracking/${trackingId}` : null,
            raw: { create: response, assign: assignRaw },
        };
    }

    async trackShipment(trackingId: string): Promise<TrackingResult> {
        const response = await this.request<any>(`/courier/track/awb/${trackingId}`);
        return {
            currentStatus: response?.tracking_data?.shipment_track?.[0]?.current_status ?? "UNKNOWN",
            raw: response,
        };
    }

    async cancelShipment(trackingIds: string[]): Promise<void> {
        await this.request("/orders/cancel", {
            method: "POST",
            body: JSON.stringify({ awbs: trackingIds }),
        });
    }

    async getServiceability(
        pickupPincode: string,
        deliveryPincode: string,
        weight: number,
        cod: boolean
    ): Promise<ServiceabilityResult> {
        const params = new URLSearchParams({
            pickup_postcode: pickupPincode,
            delivery_postcode: deliveryPincode,
            weight: String(weight),
            cod: cod ? "1" : "0",
        });
        const response = await this.request<any>(`/courier/serviceability/?${params}`);
        return {
            available: response?.status === 200,
            couriers: response?.data?.available_courier_companies ?? [],
            recommendedCourierId: response?.data?.recommended_courier_company_id ?? null,
            raw: response,
        };
    }

    async createReversePickup(input: CreateShipmentInput): Promise<ShipmentResult> {
        const response = await this.request<any>("/orders/create/return", {
            method: "POST",
            body: JSON.stringify({
                order_id: `return_${input.orderId}`,
                order_date: new Date().toISOString().split("T")[0],
                pickup_customer_name: input.receiverName,
                pickup_address: input.address,
                pickup_city: input.city,
                pickup_pincode: input.pincode,
                pickup_state: input.state,
                pickup_country: input.country,
                pickup_email: input.email,
                pickup_phone: input.phone,
                weight: input.weight,
                order_items: input.items.map((i) => ({
                    name: i.name,
                    sku: i.sku,
                    units: i.units,
                    selling_price: i.sellingPrice,
                })),
            }),
        });
        const trackingId = response?.payload?.awb_code ?? null;
        return {
            trackingId,
            trackingUrl: trackingId ? `https://shiprocket.co/tracking/${trackingId}` : null,
            raw: response,
        };
    }

    verifyWebhook(payload: Buffer | string, token: string): boolean {
        if (timingSafeEqualStr(config.shiprocketWebhookSecret, token)) return true;

        const rawBody = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
        const expected = crypto
            .createHmac("sha256", config.shiprocketWebhookSecret)
            .update(rawBody)
            .digest("hex");
        return timingSafeEqualStr(expected, token);
    }

    parseWebhookEvent(payload: Buffer | string): WebhookEvent {
        const parsed = typeof payload === "string" || Buffer.isBuffer(payload)
            ? JSON.parse(payload.toString("utf8"))
            : payload;

        return {
            event: parsed.event ?? "unknown",
            trackingId: parsed.awb ?? "",
            status: parsed.current_status ?? "unknown",
            orderId: parsed.order_id,
            raw: parsed,
        };
    }
}