import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_ADMIN: z.string().min(1, "DATABASE_URL_ADMIN is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_PRIVATE_KEY: z.string().optional().default(""),
  JWT_PUBLIC_KEY: z.string().optional().default(""),
  JWT_ISSUER: z.string().default("https://yourdomain.com"),
  JWT_AUDIENCE: z.string().default("https://yourdomain.com"),
  JWT_SECRET: z.string().optional(),

  ACCESS_TOKEN_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),

  ALLOWED_ORIGINS: z.string().optional(),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"),

  SHIPROCKET_EMAIL: z.string().min(1),
  SHIPROCKET_PASSWORD: z.string().min(1),
  SHIPROCKET_WEBHOOK_SECRET: z.string().min(1),

  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  RESEND_API_TOKEN: z.string().min(1),
  COMPANY_EMAIL: z.string().email(),
  SECURITY_ALERT_EMAIL: z.string().email().optional(),

  MSG91_AUTH_KEY: z.string().min(1),
  MSG91_SENDER_ID: z.string().min(1),
  MSG91_OTP_TEMPLATE_ID: z.string().min(1),
  MSG91_ORDER_PLACED_TEMPLATE_ID: z.string().min(1),
  MSG91_SHIPMENT_TEMPLATE_ID: z.string().min(1),

  APP_URL: z.string().url(),

  STORAGE_PROVIDER: z.enum(["aws", "do", "railway"]),

  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_CDN_URL: z.string().optional().default(""),

  DO_SPACES_REGION: z.string().optional(),
  DO_SPACES_KEY: z.string().optional(),
  DO_SPACES_SECRET: z.string().optional(),
  DO_SPACES_BUCKET: z.string().optional(),
  DO_SPACES_CDN_URL: z.string().optional().default(""),
  RAILWAY_BUCKET_ENDPOINT: z.string().optional(),
  RAILWAY_BUCKET_REGION: z.string().optional().default("us-east-1"),
  RAILWAY_BUCKET_ACCESS_KEY_ID: z.string().optional(),
  RAILWAY_BUCKET_SECRET_ACCESS_KEY: z.string().optional(),
  RAILWAY_BUCKET_NAME: z.string().optional(),
  RAILWAY_BUCKET_CDN_URL: z.string().optional().default(""),

  SEARCH_INDEX_PROVIDER: z.enum(["opensearch", "sandbox"]).optional().default("sandbox"),
  OPENSEARCH_URL: z.string().optional(),
  OPENSEARCH_USERNAME: z.string().optional(),
  OPENSEARCH_PASSWORD: z.string().optional(),
  OPENSEARCH_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).optional().default("true"),

  GST_PROVIDER: z.enum(["sandbox", "surepass"]).optional().default("sandbox"),
  AADHAAR_PROVIDER: z.enum(["sandbox", "surepass"]).optional().default("sandbox"),
  PAN_PROVIDER: z.enum(["sandbox", "surepass"]).optional().default("sandbox"),
  BANK_VERIFICATION_PROVIDER: z.enum(["sandbox", "razorpayx", "surepass"]).optional().default("sandbox"),

  SANDBOX_GST_API_KEY: z.string().optional().default("sandbox-mock"),
  SANDBOX_GST_API_SECRET: z.string().optional().default("sandbox-mock"),
  SANDBOX_AADHAAR_API_KEY: z.string().optional().default("sandbox-mock"),
  SANDBOX_AADHAAR_API_SECRET: z.string().optional().default("sandbox-mock"),
  SANDBOX_PAN_API_KEY: z.string().optional().default("sandbox-mock"),
  SANDBOX_PAN_API_SECRET: z.string().optional().default("sandbox-mock"),
  SANDBOX_BANK_VERIFICATION_API_KEY: z.string().optional().default("sandbox-mock"),
  SANDBOX_BANK_VERIFICATION_API_SECRET: z.string().optional().default("sandbox-mock"),
}).superRefine((data, ctx) => {
  const requireFields = (fields: Record<string, string | undefined>, providerLabel: string) => {
    for (const [key, value] of Object.entries(fields)) {
      if (!value || value.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when provider="${providerLabel}"`,
        });
      }
    }
  };

  if (data.STORAGE_PROVIDER === "aws") {
    requireFields({
      AWS_REGION: data.AWS_REGION,
      AWS_ACCESS_KEY_ID: data.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: data.AWS_SECRET_ACCESS_KEY,
      AWS_S3_BUCKET: data.AWS_S3_BUCKET,
    }, "aws");
  }

  if (data.STORAGE_PROVIDER === "do") {
    requireFields({
      DO_SPACES_REGION: data.DO_SPACES_REGION,
      DO_SPACES_KEY: data.DO_SPACES_KEY,
      DO_SPACES_SECRET: data.DO_SPACES_SECRET,
      DO_SPACES_BUCKET: data.DO_SPACES_BUCKET,
    }, "do");
  }

  if (data.STORAGE_PROVIDER === "railway") {
    requireFields({
      RAILWAY_BUCKET_ENDPOINT: data.RAILWAY_BUCKET_ENDPOINT,
      RAILWAY_BUCKET_ACCESS_KEY_ID: data.RAILWAY_BUCKET_ACCESS_KEY_ID,
      RAILWAY_BUCKET_SECRET_ACCESS_KEY: data.RAILWAY_BUCKET_SECRET_ACCESS_KEY,
      RAILWAY_BUCKET_NAME: data.RAILWAY_BUCKET_NAME,
    }, "railway");
  }

  if (data.SEARCH_INDEX_PROVIDER === "opensearch") {
    requireFields({
      OPENSEARCH_URL: data.OPENSEARCH_URL,
      OPENSEARCH_USERNAME: data.OPENSEARCH_USERNAME,
      OPENSEARCH_PASSWORD: data.OPENSEARCH_PASSWORD,
    }, "opensearch");
  }

  if (data.NODE_ENV === "production" && data.OPENSEARCH_TLS_REJECT_UNAUTHORIZED === "false") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENSEARCH_TLS_REJECT_UNAUTHORIZED"],
      message: "OPENSEARCH_TLS_REJECT_UNAUTHORIZED cannot be \"false\" in production - that disables TLS verification against the search cluster",
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

const hasRsaKeys = env.JWT_PRIVATE_KEY.length > 0 && env.JWT_PUBLIC_KEY.length > 0;
const hasStrongSecret = !!env.JWT_SECRET && env.JWT_SECRET.length >= 32;

if (!hasRsaKeys && !hasStrongSecret) {
  console.error(
    "JWT config error: provide JWT_PRIVATE_KEY + JWT_PUBLIC_KEY (RS256) OR a strong JWT_SECRET (>=32 chars)"
  );
  process.exit(1);
}

if (!hasRsaKeys && isProd) {
  console.warn("JWT: no RSA keys configured in production — using HS256 fallback, not recommended");
}

const allowedOrigins = env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];

if (allowedOrigins.length === 0 && isProd) {
  console.error("ALLOWED_ORIGINS must be set explicitly in production (wildcard is not permitted)");
  process.exit(1);
}

if (allowedOrigins.includes("*") && isProd) {
  console.error("ALLOWED_ORIGINS cannot be '*' in production when credentials are enabled");
  process.exit(1);
}

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,

  databaseUrl: env.DATABASE_URL,
  databaseUrlAdmin: env.DATABASE_URL_ADMIN,
  redisUrl: env.REDIS_URL,

  jwtPrivateKey: env.JWT_PRIVATE_KEY.replace(/\\n/g, "\n"),
  jwtPublicKey: env.JWT_PUBLIC_KEY.replace(/\\n/g, "\n"),
  jwtIssuer: env.JWT_ISSUER,
  jwtAudience: env.JWT_AUDIENCE,
  jwtSecret: env.JWT_SECRET,

  accessTokenExpiresIn: env.ACCESS_TOKEN_EXPIRES_IN,
  refreshTokenExpiresIn: env.REFRESH_TOKEN_EXPIRES_IN,

  allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : (isProd ? [] : ["*"]),

  encryptionKey: env.ENCRYPTION_KEY,

  shiprocketBaseUrl: "https://apiv2.shiprocket.in/v1/external",
  shiprocketEmail: env.SHIPROCKET_EMAIL,
  shiprocketPassword: env.SHIPROCKET_PASSWORD,
  shiprocketWebhookSecret: env.SHIPROCKET_WEBHOOK_SECRET,

  razorpayKeyId: env.RAZORPAY_KEY_ID,
  razorpayKeySecret: env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,

  resendApiToken: env.RESEND_API_TOKEN,
  companyEmail: env.COMPANY_EMAIL,
  securityAlertEmail: env.SECURITY_ALERT_EMAIL ?? env.COMPANY_EMAIL,

  msg91BaseUrl: "https://api.msg91.com/api/v5",
  msg91AuthKey: env.MSG91_AUTH_KEY,
  msg91SenderId: env.MSG91_SENDER_ID,
  msg91OtpTemplateId: env.MSG91_OTP_TEMPLATE_ID,
  msg91OrderPlacedTemplateId: env.MSG91_ORDER_PLACED_TEMPLATE_ID,
  msg91ShipmentTemplateId: env.MSG91_SHIPMENT_TEMPLATE_ID,

  appUrl: env.APP_URL,

  storageProvider: env.STORAGE_PROVIDER,

  awsRegion: env.AWS_REGION ?? "",
  awsAccessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
  awsS3Bucket: env.AWS_S3_BUCKET ?? "",
  awsCdnUrl: env.AWS_CDN_URL,

  doSpacesRegion: env.DO_SPACES_REGION ?? "",
  doSpacesKey: env.DO_SPACES_KEY ?? "",
  doSpacesSecret: env.DO_SPACES_SECRET ?? "",
  doSpacesBucket: env.DO_SPACES_BUCKET ?? "",
  doSpacesCdnUrl: env.DO_SPACES_CDN_URL,

  railwayBucketEndpoint: env.RAILWAY_BUCKET_ENDPOINT ?? "",
  railwayBucketRegion: env.RAILWAY_BUCKET_REGION,
  railwayBucketAccessKeyId: env.RAILWAY_BUCKET_ACCESS_KEY_ID ?? "",
  railwayBucketSecretAccessKey: env.RAILWAY_BUCKET_SECRET_ACCESS_KEY ?? "",
  railwayBucketName: env.RAILWAY_BUCKET_NAME ?? "",
  railwayBucketCdnUrl: env.RAILWAY_BUCKET_CDN_URL,

  searchIndexProvider: env.SEARCH_INDEX_PROVIDER,
  opensearchUrl: env.OPENSEARCH_URL ?? "",
  opensearchUsername: env.OPENSEARCH_USERNAME ?? "",
  opensearchPassword: env.OPENSEARCH_PASSWORD ?? "",
  opensearchTlsRejectUnauthorized: env.OPENSEARCH_TLS_REJECT_UNAUTHORIZED === "true",

  gstProvider: env.GST_PROVIDER,
  aadhaarProvider: env.AADHAAR_PROVIDER,
  panProvider: env.PAN_PROVIDER,
  bankVerificationProvider: env.BANK_VERIFICATION_PROVIDER,

  sandboxGstApiKey: env.SANDBOX_GST_API_KEY,
  sandboxGstApiSecret: env.SANDBOX_GST_API_SECRET,
  sandboxAadhaarApiKey: env.SANDBOX_AADHAAR_API_KEY,
  sandboxAadhaarApiSecret: env.SANDBOX_AADHAAR_API_SECRET,
  sandboxPanApiKey: env.SANDBOX_PAN_API_KEY,
  sandboxPanApiSecret: env.SANDBOX_PAN_API_SECRET,
  sandboxBankVerificationApiKey: env.SANDBOX_BANK_VERIFICATION_API_KEY,
  sandboxBankVerificationApiSecret: env.SANDBOX_BANK_VERIFICATION_API_SECRET,
} as const;
