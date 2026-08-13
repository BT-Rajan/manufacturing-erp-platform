/**
 * Request ID + request logging. Logs method/path/status/duration only
 * -- never request bodies or headers, so credentials never end up in
 * logs. Carries forward the same guarantee jdk_clean's request logging
 * made (see docs/PARITY_CHECKLIST.md).
 */

import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { logger } from "../../core/logging/logger.js";

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  res.locals["requestId"] = requestId;
  res.setHeader("X-Request-ID", requestId);

  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info(
      `request_id=${requestId} method=${req.method} path=${req.path} status=${res.statusCode} duration_ms=${durationMs.toFixed(0)}`,
    );
  });

  next();
}
