/**
 * One shared implementation of the transition-checking logic, so it
 * doesn't get hand-copied into feasibility/orders/quotations/purchase
 * orders/production with slightly different wording each time. This
 * does NOT force a single universal status enum across domains --
 * each domain's own ALLOWED_TRANSITIONS table still encodes its own
 * genuinely different states. What's shared is the *mechanism* for
 * checking a transition, not the states themselves. Ported from
 * jdk_clean's core/workflow.py.
 */

import { ConflictError, ValidationAppError } from "../errors/index.js";

export function assertTransitionAllowed<S extends string>(
  allowedTransitions: Record<S, Set<S>>,
  currentStatus: S,
  newStatus: S,
  entityLabel: string,
): void {
  const allowed = allowedTransitions[currentStatus] ?? new Set<S>();
  if (!allowed.has(newStatus)) {
    throw new ConflictError(`Cannot move ${entityLabel} from '${currentStatus}' to '${newStatus}'.`);
  }
}

export function assertReasonGiven(reason: string | null | undefined, message: string): void {
  if (!reason || !reason.trim()) {
    throw new ValidationAppError(message);
  }
}
