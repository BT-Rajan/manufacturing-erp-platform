export type DeliveryNoteStatus = "draft" | "issued" | "cancelled";

/** 'issued' is terminal on purpose: issuing drives the linked order to
 * 'shipped' (a real inventory/order state change) -- cancel the order
 * itself if a shipment needs to be undone, not this note. */
export const ALLOWED_TRANSITIONS: Record<DeliveryNoteStatus, Set<DeliveryNoteStatus>> = {
  draft: new Set(["issued", "cancelled"]),
  issued: new Set(),
  cancelled: new Set(),
};

/** Only an order in this status can get a delivery note -- issuing
 * then drives the order the rest of the way to 'shipped', reusing
 * orders' own changeStatus (stock-issue + reservation-release) rather
 * than duplicating it here. */
export const ELIGIBLE_ORDER_STATUS = "ready_to_ship";
