import { db } from "../../db";

type Entity = "product" | "shop" | "shipment" | "order" | "invoice" | "purchaseOrder";

const PREFIX: Record<Entity, string> = {
    product: "PROD",
    shop: "SHOP",
    shipment: "SHIP",
    order: "ORD",
    invoice: "INV",
    purchaseOrder: "PO",
};

const SEQUENCE: Record<Entity, string> = {
    product: "product_display_seq",
    shop: "shop_display_seq",
    shipment: "shipment_display_seq",
    order: "order_display_seq",
    invoice: "invoice_display_seq",
    purchaseOrder: "purchase_order_display_seq",
};

export async function generateDisplayId(entity: Entity): Promise<string> {
    const result = await db.$queryRawUnsafe<{ nextval: bigint }[]>(
        `SELECT nextval('${SEQUENCE[entity]}')`
    );
    const num = Number(result[0]!.nextval);
    return `${PREFIX[entity]}-${String(num).padStart(6, "0")}`;
}