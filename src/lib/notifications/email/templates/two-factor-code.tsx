import { Html, Body, Head, Preview, Container, Heading, Text, Hr } from "@react-email/components";

interface TwoFactorCodeProps {
  name: string;
  code: string;
  expiresInMinutes: number;
  purpose: string;
}

export function TwoFactorCodeEmail({ name, code, expiresInMinutes, purpose }: TwoFactorCodeProps) {
  return (
    <Html>
      <Head />
      <Preview>Your verification code is {code}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>Your verification code</Heading>
          <Text>Hi {name},</Text>
          <Text>Use this code to {purpose}. It expires in {expiresInMinutes} minutes.</Text>
          <Text
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 8,
              textAlign: "center",
              margin: "24px 0",
              color: "#111827",
            }}
          >
            {code}
          </Text>
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            If you didn't request this, you can safely ignore this email.
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
