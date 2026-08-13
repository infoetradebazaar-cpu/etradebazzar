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
  userId: string;
  path: string;
  method: string;
  requiredRoles: string;
  requiredPermissionKeys: string;
  legacyCheckPassed: boolean;
  permissionCheckPassed: boolean;
  occurredAt: string;
}

export function RbacDisagreementAlertEmail({
  userId,
  path,
  method,
  requiredRoles,
  requiredPermissionKeys,
  legacyCheckPassed,
  permissionCheckPassed,
  occurredAt,
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>Platform RBAC dual-run check disagreement</Preview>
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
            RBAC dual-run disagreement
          </Heading>
          <Text>
            The legacy role check and the new permission-key check disagreed
            on a platform-admin request. Access was denied either way (AND
            gate), but this needs investigation before the legacy check is
            removed.
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
            userId: {userId}
            <br />
            request: {method} {path}
            <br />
            requiredRoles: {requiredRoles}
            <br />
            requiredPermissionKeys: {requiredPermissionKeys}
            <br />
            legacy requirePlatformAdmin passed: {String(legacyCheckPassed)}
            <br />
            new requirePlatformPermission passed: {String(permissionCheckPassed)}
            <br />
            occurredAt: {occurredAt}
          </Text>
          <Hr />
          <Text style={{ color: "#6b7280", fontSize: 12 }}>
            ETradeBazaar Platform Security
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
