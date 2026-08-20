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

type Props =
  | {
      reason: "auto_rejected";
      customerName: string;
      productName: string;
      quantity: number;
      lastOfferedPrice: number;
      negotiationUrl: string;
    }
  | {
      reason: "manual_expired";
      customerName: string;
      productName: string;
      quantity: number;
      visiblePrice: number;
      negotiationUrl: string;
    };

export function NegotiationNudgeEmail(props: Props) {
  const { customerName, productName, quantity, negotiationUrl } = props;
  const unit = `${quantity} unit${quantity === 1 ? "" : "s"}`;

  const heading = props.reason === "auto_rejected" ? "Didn't find a price that worked?" : "Your negotiation is still open";
  const preview =
    props.reason === "auto_rejected"
      ? `Still interested in ${productName}? Talk directly with the seller`
      : `Your negotiation for ${productName} didn't conclude - it's still available`;
  const buttonLabel = props.reason === "auto_rejected" ? "Start a direct negotiation" : "View negotiation";

  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
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
          <Heading style={{ color: "#4338ca" }}>{heading}</Heading>
          <Text>Hi {customerName},</Text>
          {props.reason === "auto_rejected" ? (
            <>
              <Text>
                Our best automated offer for {unit} of <strong>{productName}</strong> was ₹
                {props.lastOfferedPrice.toLocaleString("en-IN")}, and it looks like that didn&apos;t quite
                work for you.
              </Text>
              <Text>
                For orders at this volume, you can also negotiate directly with the seller - discuss your
                requirements, agree on a price together, and schedule a time to talk it through.
              </Text>
            </>
          ) : (
            <>
              <Text>
                Your negotiation with the seller for {unit} of <strong>{productName}</strong> didn&apos;t
                reach a conclusion, so it&apos;s been closed for now.
              </Text>
              <Text>
                Good news - it&apos;s still available at ₹{props.visiblePrice.toLocaleString("en-IN")}. You
                can pick up the conversation again whenever suits you, or order at the listed price directly.
              </Text>
            </>
          )}
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
            {buttonLabel}
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
