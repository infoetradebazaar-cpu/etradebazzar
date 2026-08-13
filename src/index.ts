import app from "./app";
import { config } from "../config/config";
import { logger } from "./utils/logger";
import { redis } from "./db/redis";
import { connectDb, disconnectDb } from "./db/index";
import { startSlaMonitor, stopSlaMonitor } from "./lib/sla/sla-monitor";
import { startNegotiationNudgeMonitor, stopNegotiationNudgeMonitor } from "./lib/negotiation/nudge-monitor";
import { startNotificationRetryWorker, stopNotificationRetryWorker } from "./lib/notifications/notification-retry.worker";
import { startSseRedisSubscriber, stopSseRedisSubscriber } from "./lib/notifications/sse/sse.redis";

let server: ReturnType<typeof app.listen>;

async function start() {
  try {
    await connectDb();
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to connect to database, exiting");
    process.exit(1);
  }

  server = app.listen(config.port, () => {
    const address = server.address();
    const host =
      typeof address === "string" ? address : address?.address || "localhost";
    const actualPort = typeof address === "string" ? config.port : address?.port || config.port;
    const url = `http://${host === "::" ? "localhost" : host}:${actualPort}`;
    logger.info(`Server running at ${url}`);
  });
  startSlaMonitor();
  startNegotiationNudgeMonitor();
  startNotificationRetryWorker();
  startSseRedisSubscriber();
}

let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, 10000);

  server?.close(async () => {
    stopSlaMonitor();
    stopNegotiationNudgeMonitor();
    stopNotificationRetryWorker();
    await stopSseRedisSubscriber();
    try {
      await disconnectDb();
    } catch (err: any) {
      logger.error({ err: err.message }, "Error disconnecting database");
    }

    try {
      if (redis.status === "ready" || redis.status === "connecting") {
        await redis.quit();
      }
    } catch (err: any) {
      logger.error({ err: err.message }, "Error disconnecting Redis");
    }

    clearTimeout(forceExitTimer);
    logger.info("Shutdown complete");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "Uncaught exception , shutting down");
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: any) => {
  logger.error(
    { err: reason?.message || reason },
    "Unhandled rejection, shutting down",
  );
  shutdown("unhandledRejection");
});

start();