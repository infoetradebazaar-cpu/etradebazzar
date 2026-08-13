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
  customerName: string;
  productName: string;
  quantity: number;
  lastOfferedPrice: number;
  negotiationUrl: string;
}

export function NegotiationNudgeEmail({
  customerName,
  productName,
  quantity,
  lastOfferedPrice,
  negotiationUrl,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>Still interested in {productName}? Talk directly with the seller</Preview>
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
          <Heading style={{ color: "#4338ca" }}>Didn&apos;t find a price that worked?</Heading>
          <Text>Hi {customerName},</Text>
          <Text>
            Our best automated offer for {quantity} unit{quantity === 1 ? "" : "s"} of{" "}
            <strong>{productName}</strong> was ₹{lastOfferedPrice.toLocaleString("en-IN")}, and it looks
            like that didn&apos;t quite work for you.
          </Text>
          <Text>
            For orders at this volume, you can also negotiate directly with the seller - discuss your
            requirements, agree on a price together, and schedule a time to talk it through.
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
            Start a direct negotiation
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
