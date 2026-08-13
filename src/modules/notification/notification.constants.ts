import { NotificationCategory } from "../../../prisma/generated/client";

export const ALL_CATEGORIES: NotificationCategory[] = [
    "ORDER",
    "SHIPMENT",
    "PAYOUT",
    "NEGOTIATION",
    "PROMOTION",
    "SECURITY",
    "ACCOUNT",
];

export const NON_DISABLEABLE_CATEGORIES: NotificationCategory[] = ["SECURITY"];
