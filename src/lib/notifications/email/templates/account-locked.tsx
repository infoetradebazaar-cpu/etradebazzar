import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Hr,
  Preview,
} from "@react-email/components";

interface Props {
  name: string;
  retryAfterMinutes: number;
}

export function AccountLockedEmail({ name, retryAfterMinutes }: Props) {
  return (
    <Html>
      <Head />
      <Preview>Your account was temporarily locked after repeated failed sign-in attempts</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{
            maxWidth: 600,
            margin: "40px auto",
            background: "#fff",
            borderRadius: 8,
            padding: 32,
          }}
        >
          <Heading style={{ color: "#b45309" }}>Sign-in temporarily locked</Heading>
          <Text>Hi {name},</Text>
          <Text>
            We saw several failed sign-in attempts on your account and locked it for about{" "}
            {retryAfterMinutes} minute{retryAfterMinutes === 1 ? "" : "s"} as a precaution. You don&apos;t
            need to do anything - it unlocks automatically, and you can try again once the time has passed.
          </Text>
          <Text
            style={{
              background: "#fffbeb",
              padding: 16,
              borderRadius: 6,
              borderLeft: "4px solid #b45309",
            }}
          >
            If this wasn&apos;t you, we recommend changing your password once you&apos;re back in, and
            checking that no one else has access to your email account.
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            ETradeBazaar Account Security
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
