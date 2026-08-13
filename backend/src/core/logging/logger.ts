/**
 * Minimal structured logger. No third-party logging framework yet --
 * deliberately simple for Pass 0; can be swapped for pino/winston
 * later behind this same interface without touching call sites.
 */

type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, message: string): void {
  const timestamp = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level === "debug" ? "log" : level](`${timestamp} ${level.toUpperCase()} ${message}`);
}

export const logger = {
  debug: (message: string) => log("debug", message),
  info: (message: string) => log("info", message),
  warn: (message: string) => log("warn", message),
  error: (message: string) => log("error", message),
};
