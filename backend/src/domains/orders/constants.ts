export type OrderStatus = "draft" | "confirmed" | "in_production" | "ready_to_ship" | "shipped" | "delivered" | "cancelled";

export const ALLOWED_TRANSITIONS: Record<OrderStatus, Set<OrderStatus>> = {
  draft: new Set(["confirmed", "cancelled"]),
  // 'ready_to_ship' is reachable directly from 'confirmed' -- not just
  // via 'in_production' -- for the case where every line is already
  // covered by existing finished-goods stock and nothing actually needs
  // producing (Pass 2e's auto-schedule-production hook). A person can
  // also choose it directly for the same reason.
  confirmed: new Set(["in_production", "ready_to_ship", "cancelled"]),
  in_production: new Set(["ready_to_ship", "cancelled"]),
  ready_to_ship: new Set(["shipped", "cancelled"]),
  shipped: new Set(["delivered"]),
  delivered: new Set(),
  cancelled: new Set(),
};

/** Statuses at/after which finished-goods stock has been reserved for
 * this order -- used to decide whether cancelling needs to release a
 * reservation. */
export const RESERVED_STATUSES: ReadonlySet<OrderStatus> = new Set(["confirmed", "in_production", "ready_to_ship"]);

export const STATUSES_REQUIRING_CLOSE_REASON: ReadonlySet<OrderStatus> = new Set(["cancelled"]);

/** "Open" for the overdue-delivery admin escalation. */
export const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set(["draft", "confirmed", "in_production", "ready_to_ship"]);
