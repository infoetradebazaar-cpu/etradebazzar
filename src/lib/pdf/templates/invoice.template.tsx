import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceSnapshot } from "../../../modules/invoicing/invoicing.types";

const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
    title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
    subtitle: { fontSize: 10, color: "#6b7280", marginBottom: 20 },
    row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
    col: { flexDirection: "column", maxWidth: "48%" },
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
    footer: { marginTop: 32, fontSize: 8, color: "#9ca3af" },
    provisionalBanner: {
        backgroundColor: "#fef2f2",
        borderWidth: 1,
        borderColor: "#fecaca",
        borderRadius: 4,
        padding: 8,
        marginBottom: 16,
    },
    provisionalTitle: { fontSize: 10, fontWeight: 700, color: "#991b1b", marginBottom: 3 },
    provisionalReason: { fontSize: 8, color: "#991b1b", marginBottom: 2 },
});

function formatMoney(amount: number): string {
    return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function InvoiceDocument({ snapshot }: { snapshot: InvoiceSnapshot }) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.title}>Tax Invoice</Text>
                <Text style={styles.subtitle}>
                    Invoice No: {snapshot.invoiceNumber}  |  Order: {snapshot.orderDisplayId ?? snapshot.orderId}  |{" "}
                    Date: {new Date(snapshot.issuedAt).toLocaleDateString("en-IN")}
                </Text>

                {snapshot.isProvisional ? (
                    <View style={styles.provisionalBanner}>
                        <Text style={styles.provisionalTitle}>
                            PROVISIONAL - NOT VALID FOR GST FILING
                        </Text>
                        {snapshot.provisionalReasons.map((reason, i) => (
                            <Text style={styles.provisionalReason} key={i}>
                                - {reason}
                            </Text>
                        ))}
                    </View>
                ) : null}

                <View style={styles.row}>
                    <View style={styles.col}>
                        <Text style={styles.label}>Sold By</Text>
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
                        <Text style={styles.partyLine}>{snapshot.seller.email}</Text>
                    </View>
                    <View style={styles.col}>
                        <Text style={styles.label}>Billed To</Text>
                        <Text style={styles.partyName}>{snapshot.buyer.name}</Text>
                        <Text style={styles.partyLine}>
                            {snapshot.buyer.address.street}, {snapshot.buyer.address.city}
                        </Text>
                        <Text style={styles.partyLine}>
                            {snapshot.buyer.address.state} - {snapshot.buyer.address.pincode}
                        </Text>
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
                    {snapshot.taxAmount > 0 ? (
                        <View style={styles.totalRow}>
                            <Text>GST ({snapshot.taxRate}% incl.)</Text>
                            <Text>{formatMoney(snapshot.taxAmount)}</Text>
                        </View>
                    ) : null}
                    <View style={styles.grandTotalRow}>
                        <Text>Grand Total</Text>
                        <Text>{formatMoney(snapshot.grandTotal)}</Text>
                    </View>
                </View>

                <Text style={styles.footer}>
                    This is a system-generated invoice for order {snapshot.orderDisplayId ?? snapshot.orderId}.
                </Text>
            </Page>
        </Document>
    );
}
