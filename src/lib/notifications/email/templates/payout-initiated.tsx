import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface PayoutInitiatedProps {
  sellerName: string;
  businessName: string;
  netAmount: number;
  payoutUrl: string;
}

export function PayoutInitiatedEmail({ sellerName, businessName, netAmount, payoutUrl }: PayoutInitiatedProps) {
  return (
    <Html>
      <Head />
      <Preview>A payout of ₹{netAmount.toFixed(2)} has been initiated</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>Payout Initiated</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            A payout of <strong>₹{netAmount.toFixed(2)}</strong> has been initiated for{" "}
            <strong>{businessName}</strong>. It's on its way to your registered bank account.
          </Text>
          <Button
            href={payoutUrl}
            style={{ background: "#4338ca", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            View Payout
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
