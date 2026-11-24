export interface CreateShipmentInput {
    orderId: string;
    pickupLocation: string;
    receiverName: string;
    address: string;
    city: string;
    pincode: string;
    state: string;
    country: string;
    email: string;
    phone: string;
    paymentMethod: string;
    subTotal: number;
    length: number;
    breadth: number;
    height: number;
    weight: number;
    items: {
        name: string;
        sku: string;
        units: number;
        sellingPrice: number;
        weight?: number;
    }[];
    courierId?: number;
    pickupPincode?: string;
}

export interface ShipmentResult {
    trackingId: string | null;
    courierName?: string | null;
    trackingUrl: string | null;
    raw: any;
}

export interface TrackingResult {
    currentStatus: string;
    raw: any;
}

export interface ServiceabilityResult {
    available: boolean;
    couriers: any[];
    recommendedCourierId?: number | null;
    raw: any;
}

export interface ShipmentProvider {
    createShipment(input: CreateShipmentInput): Promise<ShipmentResult>;
    trackShipment(trackingId: string): Promise<TrackingResult>;
    cancelShipment(trackingIds: string[]): Promise<void>;
    getServiceability(
        pickupPincode: string,
        deliveryPincode: string,
        weight: number,
        cod: boolean
    ): Promise<ServiceabilityResult>;
    createReversePickup(input: CreateShipmentInput): Promise<ShipmentResult>;
    verifyWebhook(payload: Buffer | string, signature: string): boolean;
    parseWebhookEvent(payload: Buffer | string): WebhookEvent;
}

export interface WebhookEvent {
    event: string;
    trackingId: string;
    status: string;
    orderId?: string;
    raw: any;
}