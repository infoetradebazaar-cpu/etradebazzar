import helmet from "helmet";
import cors from "cors";

import { config } from "../../config/config";
import { logger } from "../utils/logger";

const allowedOrigins = config.allowedOrigins;
const isWildcard = allowedOrigins.length === 1 && allowedOrigins[0] === "*";

if (isWildcard) {
  logger.warn(
    "CORS is configured with a wildcard origin credentials will be disabled for cross-origin requests"
  );
}

const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (isWildcard || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: !isWildcard,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Request-Id", "X-Active-Org-Id"],
  exposedHeaders: ["X-Request-Id"],
});

const helmetMiddleware = helmet({
  contentSecurityPolicy:
    config.nodeEnv === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  originAgentCluster: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xContentTypeOptions: true,
});

export const security = [helmetMiddleware, corsMiddleware];