import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface PayoutFailedProps {
  sellerName: string;
  netAmount: number;
  failureReason?: string;
  payoutUrl: string;
}

export function PayoutFailedEmail({ sellerName, netAmount, failureReason, payoutUrl }: PayoutFailedProps) {
  return (
    <Html>
      <Head />
      <Preview>Payout of ₹{netAmount.toFixed(2)} failed</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#dc2626" }}>Payout Failed</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            Your payout of <strong>₹{netAmount.toFixed(2)}</strong> could not be completed.
            {failureReason ? (
              <>
                {" "}
                Reason: <strong>{failureReason}</strong>.
              </>
            ) : null}{" "}
            Our team will investigate and retry - no action is needed from you right now.
          </Text>
          <Button
            href={payoutUrl}
            style={{ background: "#dc2626", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
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
