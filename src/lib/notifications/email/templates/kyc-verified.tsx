import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface KycVerifiedProps {
  sellerName: string;
  dashboardUrl: string;
}

export function KycVerifiedEmail({ sellerName, dashboardUrl }: KycVerifiedProps) {
  return (
    <Html>
      <Head />
      <Preview>Your KYC has been verified</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#16a34a" }}>KYC Verified</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>Your KYC documents have been verified successfully. Your account is in good standing.</Text>
          <Button
            href={dashboardUrl}
            style={{ background: "#16a34a", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Go to Dashboard
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
