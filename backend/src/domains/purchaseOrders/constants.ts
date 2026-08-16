export type PurchaseOrderStatus = "draft" | "sent" | "confirmed" | "partially_received" | "received" | "cancelled";

export const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, Set<PurchaseOrderStatus>> = {
  draft: new Set(["sent", "cancelled"]),
  sent: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["partially_received", "received", "cancelled"]),
  partially_received: new Set(["received", "cancelled"]),
  received: new Set(),
  cancelled: new Set(),
};
