import { getPlatformConfigNumber } from "../platform-config/platform-config";

export const PAYMENT_TERMS_DEFAULTS = {
    ADVANCE_PERCENT: 50,
    GATEWAY_SURCHARGE_PERCENT: 2,
};

export async function getAdvancePercent(): Promise<number> {
    const v = await getPlatformConfigNumber("ADVANCE_PERCENT", PAYMENT_TERMS_DEFAULTS.ADVANCE_PERCENT);
    return Math.min(100, Math.max(1, v));
}

export async function getGatewaySurchargePercent(): Promise<number> {
    const v = await getPlatformConfigNumber("GATEWAY_SURCHARGE_PERCENT", PAYMENT_TERMS_DEFAULTS.GATEWAY_SURCHARGE_PERCENT);
    return Math.min(10, Math.max(0, v));
}

export function withSurcharge(amount: number, percent: number) {
    const surcharge = parseFloat(((amount * percent) / 100).toFixed(2));
    return { surcharge, gatewayAmount: parseFloat((amount + surcharge).toFixed(2)) };
}