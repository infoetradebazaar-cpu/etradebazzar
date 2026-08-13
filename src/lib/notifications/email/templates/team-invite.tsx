import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface TeamInviteProps {
  businessName: string;
  roleName: string;
  inviteUrl: string;
  isReminder?: boolean;
}

export function TeamInviteEmail({ businessName, roleName, inviteUrl, isReminder }: TeamInviteProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {isReminder ? "Reminder: " : ""}You've been invited to join {businessName}
      </Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>
            {isReminder ? "Reminder: You're invited" : "You're invited"}
          </Heading>
          <Text>
            You've been invited to join <strong>{businessName}</strong> on ETradeBazaar as{" "}
            <strong>{roleName}</strong>.
          </Text>
          <Button
            href={inviteUrl}
            style={{ background: "#4338ca", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Accept Invite
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
