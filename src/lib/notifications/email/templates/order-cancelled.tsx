import { Html,Body, Head, Preview, Container, Heading, Text, Button, Hr, } from "@react-email/components";
interface OrderCancelledProps {
  customerName: string;
  orderId: string;
  orderUrl: string;
}

export function OrderCancelledEmail({
  customerName,
  orderId,
  orderUrl,
}: OrderCancelledProps) {
  return (
    <Html>
      <Head />
      <Preview>Order #{orderId} cancelled</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{
            maxWidth: 600,
            margin: "40px auto",
            background: "#fff",
            borderRadius: 8,
            padding: 32,
          }}
        >
          <Heading style={{ color: "#dc2626" }}>Order Cancelled</Heading>
          <Text>Hi {customerName},</Text>
          <Text>
            Your order <strong>#{orderId}</strong> has been cancelled. If a
            payment was already made, a refund has been initiated.
          </Text>
          <Button
            href={orderUrl}
            style={{
              background: "#dc2626",
              color: "#fff",
              padding: "12px 24px",
              borderRadius: 6,
              textDecoration: "none",
            }}
          >
            View Order
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
