import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { AppError } from "./exceptions.js";
import { logger } from "../logging/logger.js";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = res.locals["requestId"] as string | undefined;

  if (err instanceof AppError) {
    logger.warn(`app_error code=${err.errorCode} request_id=${requestId} path=${req.path}`);
    res.status(err.statusCode).json({
      error: { code: err.errorCode, message: err.message, requestId },
    });
    return;
  }

  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    const message = firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid request data.";
    logger.warn(`validation_error request_id=${requestId} path=${req.path}`);
    res.status(422).json({
      error: { code: "validation_error", message, requestId },
    });
    return;
  }

  logger.error(
    `unhandled_error request_id=${requestId} path=${req.path} message=${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "An unexpected error occurred.",
      requestId,
    },
  });
}
