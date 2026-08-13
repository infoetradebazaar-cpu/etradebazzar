import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface ReturnRejectedProps {
  customerName: string;
  orderId: string;
  reason?: string;
  returnUrl: string;
}

export function ReturnRejectedEmail({ customerName, orderId, reason, returnUrl }: ReturnRejectedProps) {
  return (
    <Html>
      <Head />
      <Preview>Your return for order #{orderId} was rejected</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#dc2626" }}>Return Rejected</Heading>
          <Text>Hi {customerName},</Text>
          <Text>
            Your return request for order <strong>#{orderId}</strong> was rejected.
            {reason ? (
              <>
                {" "}
                Reason: <strong>{reason}</strong>.
              </>
            ) : null}
          </Text>
          <Button
            href={returnUrl}
            style={{ background: "#dc2626", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
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
