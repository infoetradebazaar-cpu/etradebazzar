import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface KycRejectedProps {
  sellerName: string;
  reason: string;
  dashboardUrl: string;
}

export function KycRejectedEmail({ sellerName, reason, dashboardUrl }: KycRejectedProps) {
  return (
    <Html>
      <Head />
      <Preview>Your KYC submission needs attention</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#dc2626" }}>KYC Rejected</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            Your KYC submission was rejected. Reason: <strong>{reason}</strong>. Please review and resubmit your
            documents.
          </Text>
          <Button
            href={dashboardUrl}
            style={{ background: "#dc2626", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Resubmit KYC
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
