import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface ReturnApprovedProps {
  customerName: string;
  orderId: string;
  trackingId?: string;
  trackingUrl?: string;
  returnUrl: string;
}

export function ReturnApprovedEmail({ customerName, orderId, trackingId, trackingUrl, returnUrl }: ReturnApprovedProps) {
  return (
    <Html>
      <Head />
      <Preview>Your return for order #{orderId} has been approved</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#16a34a" }}>Return Approved</Heading>
          <Text>Hi {customerName},</Text>
          <Text>
            Your return request for order <strong>#{orderId}</strong> has been approved.
            {trackingId ? (
              <>
                {" "}
                Pickup tracking ID: <strong>{trackingId}</strong>.
              </>
            ) : null}
          </Text>
          <Button
            href={trackingUrl ?? returnUrl}
            style={{ background: "#16a34a", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            {trackingUrl ? "Track Pickup" : "View Return"}
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
