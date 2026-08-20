export type DetectedFileType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf"
  | "model/gltf-binary"
  | "model/gltf+json"
  | "video/mp4"
  | "video/quicktime"
  | "video/webm"
  | "video/x-matroska";

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
  // ISO-BMFF container (mp4/mov share the same "ftyp" box at offset 4).
  if (buffer.length >= 12 && matchesAscii(buffer, 4, "ftyp")) {
    const majorBrand = buffer.subarray(8, 12).toString("ascii");
    return majorBrand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3
  ) {
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
    if (head.includes("webm")) return "video/webm";
    return "video/x-matroska";
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
