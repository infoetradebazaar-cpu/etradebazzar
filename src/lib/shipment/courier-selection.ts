export interface CourierOption {
    courier_company_id: number;
    courier_name?: string;
    rate?: number | string;
    freight_charge?: number | string;
    rating?: number | string;
    estimated_delivery_days?: number | string;
    etd_hours?: number | string;
}

const MIN_RATING = 3.5;
const ETD_SLACK_DAYS = 2;

const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};
const price = (c: CourierOption) => num(c.rate ?? c.freight_charge, Number.POSITIVE_INFINITY);
const days = (c: CourierOption) =>
    c.estimated_delivery_days !== undefined ? num(c.estimated_delivery_days, 99) : num(c.etd_hours, 99 * 24) / 24;

export function selectCourier(couriers: CourierOption[], recommendedId?: number | null): CourierOption | null {
    const valid = couriers.filter((c) => c && c.courier_company_id);
    if (!valid.length) return null;

    const fastest = Math.min(...valid.map(days));
    const shortlist = valid.filter((c) => num(c.rating, 0) >= MIN_RATING && days(c) <= fastest + ETD_SLACK_DAYS);
    const byCostThenRating = (a: CourierOption, b: CourierOption) =>
        price(a) - price(b) || num(b.rating, 0) - num(a.rating, 0);

    if (shortlist.length) return [...shortlist].sort(byCostThenRating)[0]!;
    const recommended = recommendedId ? valid.find((c) => c.courier_company_id === recommendedId) : undefined;
    return recommended ?? [...valid].sort(byCostThenRating)[0]!;
}