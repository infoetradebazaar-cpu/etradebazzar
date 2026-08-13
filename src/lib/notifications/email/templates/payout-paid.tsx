import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface PayoutPaidProps {
  sellerName: string;
  netAmount: number;
  utrRef?: string;
  payoutUrl: string;
}

export function PayoutPaidEmail({ sellerName, netAmount, utrRef, payoutUrl }: PayoutPaidProps) {
  return (
    <Html>
      <Head />
      <Preview>₹{netAmount.toFixed(2)} has been transferred to your account</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#16a34a" }}>Payout Successful</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            <strong>₹{netAmount.toFixed(2)}</strong> has been transferred to your registered bank account.
            {utrRef ? (
              <>
                {" "}
                UTR reference: <strong>{utrRef}</strong>.
              </>
            ) : null}
          </Text>
          <Button
            href={payoutUrl}
            style={{ background: "#16a34a", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
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
