import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { BillingBankDetails } from "../../../modules/invoicing/invoicing.types";

const styles = StyleSheet.create({
    box: { marginTop: 16, padding: 8, borderWidth: 1, borderColor: "#d1d5db" },
    heading: { fontSize: 9, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#374151" },
    line: { fontSize: 9, marginBottom: 1 },
    note: { fontSize: 8, color: "#6b7280", marginTop: 4 },
});

export function BankDetailsBlock({ bank }: { bank?: BillingBankDetails | null }) {
    if (!bank) return null;
    return (
        <View style={styles.box}>
            <Text style={styles.heading}>Bank details for RTGS / NEFT</Text>
            <Text style={styles.line}>Account name: {bank.accountHolderName}</Text>
            <Text style={styles.line}>Bank: {bank.bankName}</Text>
            <Text style={styles.line}>Account no: {bank.accountNumber}</Text>
            <Text style={styles.line}>IFSC: {bank.ifscCode}</Text>
            {bank.gatewaySurchargePercent > 0 ? (
                <Text style={styles.note}>
                    Pay by bank transfer to avoid the {bank.gatewaySurchargePercent}% online payment gateway surcharge.
                </Text>
            ) : null}
        </View>
    );
}