export type DetectedFileType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | "model/gltf-binary"
  | "model/gltf+json";

const MAX_GLTF_JSON_PARSE_SIZE = 20 * 1024 * 1024;

function matchesAscii(buffer: Buffer, offset: number, text: string): boolean {
  return buffer.subarray(offset, offset + text.length).toString("ascii") === text;
}

function looksLikeGltfJson(buffer: Buffer): boolean {
  if (buffer.length === 0 || buffer.length > MAX_GLTF_JSON_PARSE_SIZE) return false;
  const trimmed = buffer.toString("utf8").trimStart();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed?.asset?.version === "string";
  } catch {
    return false;
  }
}

export function detectFileSignature(buffer: Buffer): DetectedFileType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) {
    return "image/gif";
  }
  if (buffer.length >= 12 && matchesAscii(buffer, 0, "RIFF") && matchesAscii(buffer, 8, "WEBP")) {
    return "image/webp";
  }
  if (buffer.length >= 5 && matchesAscii(buffer, 0, "%PDF-")) {
    return "application/pdf";
  }
  if (buffer.length >= 4 && matchesAscii(buffer, 0, "glTF")) {
    return "model/gltf-binary";
  }
  if (looksLikeGltfJson(buffer)) {
    return "model/gltf+json";
  }
  return null;
}

export function validateFileContent(
  buffer: Buffer,
  allowed: readonly DetectedFileType[],
): DetectedFileType {
  const detected = detectFileSignature(buffer);
  if (!detected || !allowed.includes(detected)) {
    throw new Error(
      `File content does not match an allowed type. Allowed: ${allowed.join(", ")}`,
    );
  }
  return detected;
}
