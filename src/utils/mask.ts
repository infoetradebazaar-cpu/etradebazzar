export function maskAccountNumber(accountNumber: string): string {
    if (accountNumber.length <= 4) return "****";
    return `${"*".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
}

export function maskIdNumber(value: string): string {
    if (value.length <= 4) return "*".repeat(value.length);
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}
