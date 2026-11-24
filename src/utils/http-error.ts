import type { Response } from "express";
import { logger } from "./logger";

export function isInternalError(err: unknown): boolean {
    if (!err || typeof err !== "object") return true;
    const e = err as { name?: string; code?: unknown; constructor?: { name?: string } };
    const name = e.constructor?.name ?? e.name ?? "";
    if (name.startsWith("Prisma")) return true;
    if (typeof e.code === "string" && (/^P\d{4}$/.test(e.code) || /^E[A-Z]{3,}/.test(e.code))) return true;
    return err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError || err instanceof RangeError;
}

export function sendClientError(res: Response, err: unknown, status = 400) {
    if (isInternalError(err)) {
        logger.error({ err }, "Internal error hidden from client");
        return res.status(500).json({ success: false, error: "Internal server error" });
    }
    return res.status(status).json({ success: false, error: (err as Error).message });
}
