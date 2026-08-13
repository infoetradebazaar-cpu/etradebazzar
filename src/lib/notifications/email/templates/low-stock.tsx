import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface LowStockProps {
  sellerName: string;
  productName: string;
  currStock: number;
  threshold: number;
  productUrl: string;
}

export function LowStockEmail({ sellerName, productName, currStock, threshold, productUrl }: LowStockProps) {
  return (
    <Html>
      <Head />
      <Preview>Low stock alert for {productName}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#d97706" }}>Low Stock Alert</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            <strong>{productName}</strong> is running low on stock: only <strong>{currStock}</strong> unit
            {currStock === 1 ? "" : "s"} remaining (alert threshold: {threshold}).
          </Text>
          <Button
            href={productUrl}
            style={{ background: "#d97706", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Manage Inventory
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
