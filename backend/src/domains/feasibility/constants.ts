export type FeasibilityStatus =
  | "draft"
  | "feasible"
  | "exception_pending"
  | "exception_approved"
  | "exception_rejected"
  | "closed"
  | "converted";

/** 'feasible' / 'exception_pending' are reached by the system-run
 * check (runCheck), not a direct user-driven status jump. */
export const ALLOWED_TRANSITIONS: Record<FeasibilityStatus, Set<FeasibilityStatus>> = {
  draft: new Set(["feasible", "exception_pending"]),
  feasible: new Set(["converted", "closed"]),
  exception_pending: new Set(["exception_approved", "exception_rejected"]),
  exception_approved: new Set(["converted", "closed"]),
  exception_rejected: new Set(["closed"]),
  closed: new Set(),
  converted: new Set(),
};

/** A quotation may only be generated against a feasibility check in
 * one of these statuses (enforced by Pass 2c's quotation_service). */
export const QUOTABLE_STATUSES: ReadonlySet<FeasibilityStatus> = new Set(["feasible", "exception_approved"]);

/** "Open" = eligible for the 5-day stale escalation: any status that
 * hasn't yet reached a terminal closed/converted state. */
export const OPEN_STATUSES: ReadonlySet<FeasibilityStatus> = new Set([
  "draft",
  "feasible",
  "exception_pending",
  "exception_approved",
  "exception_rejected",
]);

export const STALE_AFTER_DAYS = 5;
