import { getBankBrand, type BankBrand } from "./bank.registry";

export function validateAccountNumber(accountNumber: string): { valid: boolean; error?: string } {
    if (!/^\d+$/.test(accountNumber)) {
        return { valid: false, error: "Account number must contain only digits" };
    }
    if (accountNumber.length < 9 || accountNumber.length > 18) {
        return { valid: false, error: "Account number must be 9-18 digits" };
    }
    return { valid: true };
}

export function validateIfscFormat(ifsc: string): { valid: boolean; error?: string } {
    if (ifsc.length !== 11) {
        return { valid: false, error: "IFSC must be exactly 11 characters" };
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
        return { valid: false, error: "Invalid IFSC format" };
    }
    return { valid: true };
}

export async function lookupIfsc(ifsc: string): Promise<{
    verified: boolean;
    bankName?: string;
    branch?: string;
    message: string;
    bankBrand?: BankBrand;
}> {
    const formatCheck = validateIfscFormat(ifsc);
    if (!formatCheck.valid) {
        return { verified: false, message: formatCheck.error! };
    }

    try {
        const res = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`);
        if (!res.ok) {
            return { verified: false, message: "IFSC not found" };
        }
        const data = await res.json() as any;
        return {
            verified: true,
            bankName: data.BANK,
            branch: data.BRANCH,
            message: "IFSC verified successfully",
            bankBrand: getBankBrand(ifsc, data.BANK),
        };
    } catch {
        return { verified: false, message: "IFSC lookup service unavailable" };
    }
}