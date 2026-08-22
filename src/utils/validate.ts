import { z } from "zod";
import  { Request, Response, NextFunction } from "express";

import { logger } from "../utils/logger";

function flattenZodErrors(
  formatted: Record<string, any>,
  prefix = "",
): Array<{ field: string; message: string }> {
  const results: Array<{ field: string; message: string }> = [];

  for (const [key, value] of Object.entries(formatted)) {
    if (key === "_errors") {
      for (const msg of value as string[]) {
        results.push({ field: prefix || "body", message: msg });
      }
    } else {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object") {
        results.push(...flattenZodErrors(value, fieldPath));
      }
    }
  }

  return results;
}

export const validate = (schema: z.ZodObject<any>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.safeParseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (!parsed.success) {
        const formatted = parsed.error.format();

        logger.warn(
          {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            errors: formatted,
          },
          "Validation failed"
        );

        return res.status(400).json({
          success: false,
          error: "Validation failed",
          details: flattenZodErrors(formatted),
        });
      }

      if (parsed.data.body !== undefined) {
        req.body = parsed.data.body;
      }

      if (parsed.data.query !== undefined) {
        Object.keys(req.query).forEach((key) => delete (req.query as any)[key]);
        Object.assign(req.query, parsed.data.query);
      }

      if (parsed.data.params !== undefined) {
        Object.assign(req.params, parsed.data.params);
      }

      next();
    } catch (error) {
      logger.error({ error }, "Unexpected validation error");

      res.status(500).json({ error: "Internal server error" });
    }
  };
};
