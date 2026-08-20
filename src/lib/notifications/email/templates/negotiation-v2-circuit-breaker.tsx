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
  acceptanceRate: string;
  acceptanceFloor: string;
  sampleSize: number;
  previousRolloutPercent: string;
  occurredAt: string;
}

export function NegotiationV2CircuitBreakerEmail({
  acceptanceRate,
  acceptanceFloor,
  sampleSize,
  previousRolloutPercent,
  occurredAt,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>Negotiation pricing-engine-v2 circuit breaker tripped</Preview>
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
          <Heading style={{ color: "#dc2626" }}>
            Negotiation pricing-engine-v2 circuit breaker tripped
          </Heading>
          <Text>
            The live acceptance rate for v2_reservation sessions dropped
            below the configured floor. The rollout percentage has been
            automatically set to 0% — no new sessions will be assigned to
            v2 until a human re-enables it. This does NOT auto-recover.
          </Text>
          <Text
            style={{
              background: "#fef2f2",
              padding: 16,
              borderRadius: 6,
              borderLeft: "4px solid #dc2626",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          >
            acceptanceRate: {acceptanceRate}
            <br />
            acceptanceFloor: {acceptanceFloor}
            <br />
            sampleSize: {sampleSize}
            <br />
            previousRolloutPercent: {previousRolloutPercent}
            <br />
            occurredAt: {occurredAt}
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            ETradeBazaar Platform - Negotiation Pricing Engine
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
