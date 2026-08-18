export type ProductionStatus = "planned" | "in_progress" | "completed" | "cancelled";

export const ALLOWED_TRANSITIONS: Record<ProductionStatus, Set<ProductionStatus>> = {
  planned: new Set(["in_progress", "cancelled"]),
  in_progress: new Set(["completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};
