export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";

export const ALLOWED_TRANSITIONS: Record<QuotationStatus, Set<QuotationStatus>> = {
  draft: new Set(["sent", "rejected"]),
  sent: new Set(["accepted", "rejected", "expired"]),
  accepted: new Set(["converted"]),
  rejected: new Set(),
  expired: new Set(),
  converted: new Set(),
};

/** 'rejected' is the only manually-driven terminal-without-order
 * status -- 'expired' is calendar-driven, not a deliberate close. */
export const STATUSES_REQUIRING_CLOSE_REASON: ReadonlySet<QuotationStatus> = new Set(["rejected"]);
