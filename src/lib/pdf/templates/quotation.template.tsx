import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { BankDetailsBlock } from "./bank-details.block";
import type { QuotationSnapshot } from "../../../modules/invoicing/invoicing.types";

const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
    title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
    subtitle: { fontSize: 10, color: "#6b7280", marginBottom: 20 },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
    col: { flexDirection: "column", maxWidth: "31%" },
    label: { fontSize: 9, color: "#6b7280", marginBottom: 2, textTransform: "uppercase" },
    partyName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
    partyLine: { fontSize: 9, marginBottom: 1 },
    table: { marginTop: 12, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
    tableHeader: {
        flexDirection: "row",
        backgroundColor: "#f3f4f6",
        paddingVertical: 6,
        paddingHorizontal: 4,
        fontWeight: 700,
    },
    tableRow: {
        flexDirection: "row",
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: "#e5e7eb",
    },
    colProduct: { width: "46%" },
    colSku: { width: "16%" },
    colQty: { width: "10%", textAlign: "right" },
    colPrice: { width: "14%", textAlign: "right" },
    colTotal: { width: "14%", textAlign: "right" },
    totals: { marginTop: 12, alignSelf: "flex-end", width: "45%" },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    grandTotalRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingTop: 6,
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: "#1f2937",
        fontWeight: 700,
        fontSize: 12,
    },
    disclaimer: {
        marginTop: 16,
        padding: 8,
        backgroundColor: "#fffbeb",
        borderWidth: 1,
        borderColor: "#fde68a",
        fontSize: 9,
        color: "#92400e",
    },
    footer: { marginTop: 16, fontSize: 8, color: "#9ca3af" },
});

function formatMoney(amount: number): string {
    return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function QuotationDocument({ snapshot }: { snapshot: QuotationSnapshot }) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.title}>Quotation</Text>
                <Text style={styles.subtitle}>
                    Quotation No: {snapshot.quotationNumber}  |  Order: {snapshot.orderDisplayId ?? snapshot.orderId}  |  Issued:{" "}
                    {new Date(snapshot.issuedAt).toLocaleDateString("en-IN")}
                </Text>

                <View style={styles.row}>
                    <View style={styles.col}>
                        <Text style={styles.label}>Seller</Text>
                        <Text style={styles.partyName}>{snapshot.seller.name}</Text>
                        <Text style={styles.partyLine}>
                            {snapshot.seller.address.street}, {snapshot.seller.address.city}
                        </Text>
                        <Text style={styles.partyLine}>
                            {snapshot.seller.address.state} - {snapshot.seller.address.pincode}
                        </Text>
                        {snapshot.seller.gstin ? (
                            <Text style={styles.partyLine}>GSTIN: {snapshot.seller.gstin}</Text>
                        ) : null}
                    </View>
                    <View style={styles.col}>
                        <Text style={styles.label}>Buyer</Text>
                        <Text style={styles.partyName}>{snapshot.buyer.name}</Text>
                        <Text style={styles.partyLine}>{snapshot.buyer.email}</Text>
                        <Text style={styles.partyLine}>{snapshot.buyer.phone}</Text>
                    </View>
                </View>

                <View style={styles.table}>
                    <View style={styles.tableHeader}>
                        <Text style={styles.colProduct}>Product</Text>
                        <Text style={styles.colSku}>SKU</Text>
                        <Text style={styles.colQty}>Qty</Text>
                        <Text style={styles.colPrice}>Unit Price</Text>
                        <Text style={styles.colTotal}>Total</Text>
                    </View>
                    {snapshot.items.map((item, i) => (
                        <View style={styles.tableRow} key={i}>
                            <Text style={styles.colProduct}>{item.productName}</Text>
                            <Text style={styles.colSku}>{item.sku ?? "-"}</Text>
                            <Text style={styles.colQty}>{item.quantity}</Text>
                            <Text style={styles.colPrice}>{formatMoney(item.unitPrice)}</Text>
                            <Text style={styles.colTotal}>{formatMoney(item.lineTotal)}</Text>
                        </View>
                    ))}
                </View>

                <View style={styles.totals}>
                    <View style={styles.totalRow}>
                        <Text>Subtotal</Text>
                        <Text>{formatMoney(snapshot.subtotal)}</Text>
                    </View>
                    {snapshot.discountAmount > 0 ? (
                        <View style={styles.totalRow}>
                            <Text>Discount</Text>
                            <Text>-{formatMoney(snapshot.discountAmount)}</Text>
                        </View>
                    ) : null}
                    <View style={styles.grandTotalRow}>
                        <Text>Quoted Total</Text>
                        <Text>{formatMoney(snapshot.grandTotal)}</Text>
                    </View>
                </View>

                <Text style={styles.disclaimer}>{snapshot.disclaimerText}</Text>

                {snapshot.terms?.length ? (
                    <View style={{ marginTop: 12 }}>
                        <Text style={{ fontSize: 9, fontWeight: 700, marginBottom: 4 }}>TERMS &amp; CONDITIONS</Text>
                        {snapshot.terms.map((t, i) => (
                            <Text key={i} style={{ fontSize: 8, marginBottom: 2 }}>
                                {i + 1}. {t}
                            </Text>
                        ))}
                    </View>
                ) : null}

                <BankDetailsBlock bank={snapshot.bankDetails} />

                <Text style={styles.footer}>
                    This quotation records the terms agreed during negotiation for order{" "}
                    {snapshot.orderDisplayId ?? snapshot.orderId}. It is not a tax invoice and is not a confirmed
                    purchase order.
                </Text>
            </Page>
        </Document>
    );
}