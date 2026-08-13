import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Hr,
  Preview,
} from "@react-email/components";

interface Props {
  sellerName: string;
  productName: string;
  quantity: number;
  negotiationUrl: string;
}

export function ManualNegotiationStartedEmail({
  sellerName,
  productName,
  quantity,
  negotiationUrl,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>A buyer wants to discuss a bulk price on {productName}</Preview>
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
          <Heading style={{ color: "#4338ca" }}>New negotiation request</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            A buyer wants to negotiate a bulk price for {quantity} unit{quantity === 1 ? "" : "s"} of{" "}
            <strong>{productName}</strong> - this quantity is outside your listed price tiers, so it
            needs a direct conversation.
          </Text>
          <Text>
            Open the chat to discuss pricing, propose a time to talk, and reach an agreement.
          </Text>
          <Button
            href={negotiationUrl}
            style={{
              background: "#4338ca",
              color: "#fff",
              padding: "12px 24px",
              borderRadius: 6,
              textDecoration: "none",
              display: "inline-block",
              marginTop: 12,
            }}
          >
            Open the conversation
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            ETradeBazaar
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
