import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface PasswordResetProps {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
  requestIp?: string;
  requestTime?: string;
}

export function PasswordResetEmail({ name, resetUrl, expiresInMinutes, requestIp, requestTime }: PasswordResetProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your ETradeBazaar password</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>Reset your password</Heading>
          <Text>Hi {name},</Text>
          <Text>
            We received a request to reset your password. Click the button below to choose a new one.
            This link expires in {expiresInMinutes} minutes and can only be used once.
          </Text>
          <Button
            href={resetUrl}
            style={{ background: "#4338ca", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Reset Password
          </Button>
          {(requestIp || requestTime) && (
            <Text style={{ color: "#6b7280", fontSize: 12 }}>
              Requested {requestTime ? `at ${requestTime}` : ""} {requestIp ? `from IP ${requestIp}` : ""}.
            </Text>
          )}
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            If you didn't request this, you can safely ignore this email — your password will not be changed.
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
