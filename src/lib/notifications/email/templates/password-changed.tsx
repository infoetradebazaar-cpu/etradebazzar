import { Html, Body, Head, Preview, Container, Heading, Text, Hr } from "@react-email/components";

interface PasswordChangedProps {
  name: string;
  changeIp?: string;
  changeTime?: string;
}

export function PasswordChangedEmail({ name, changeIp, changeTime }: PasswordChangedProps) {
  return (
    <Html>
      <Head />
      <Preview>Your ETradeBazaar password was changed</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>Your password was changed</Heading>
          <Text>Hi {name},</Text>
          <Text>
            This is a confirmation that your ETradeBazaar password was just changed. If you made this
            change, no further action is needed.
          </Text>
          {(changeIp || changeTime) && (
            <Text style={{ color: "#6b7280", fontSize: 12 }}>
              Changed {changeTime ? `at ${changeTime}` : ""} {changeIp ? `from IP ${changeIp}` : ""}.
            </Text>
          )}
          <Text>
            If you didn't do this, please contact support immediately — your account may be compromised.
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
