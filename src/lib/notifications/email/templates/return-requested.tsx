import { Html, Body, Head, Preview, Container, Heading, Text, Button, Hr } from "@react-email/components";

interface ReturnRequestedProps {
  sellerName: string;
  orderId: string;
  returnUrl: string;
}

export function ReturnRequestedEmail({ sellerName, orderId, returnUrl }: ReturnRequestedProps) {
  return (
    <Html>
      <Head />
      <Preview>Return request received for order #{orderId}</Preview>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f9fafb" }}>
        <Container
          style={{ maxWidth: 600, margin: "40px auto", background: "#fff", borderRadius: 8, padding: 32 }}
        >
          <Heading style={{ color: "#4338ca" }}>Return Request Received</Heading>
          <Text>Hi {sellerName},</Text>
          <Text>
            A customer has raised a return request for order <strong>#{orderId}</strong>. Please review and
            respond.
          </Text>
          <Button
            href={returnUrl}
            style={{ background: "#4338ca", color: "#fff", padding: "12px 24px", borderRadius: 6, textDecoration: "none" }}
          >
            Review Request
          </Button>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>ETradeBazaar</Text>
        </Container>
      </Body>
    </Html>
  );
}
