/**
 * A small typed helper for the one truly mechanical, identical-across-
 * every-domain piece: page/pageSize math and the { items, total, page,
 * pageSize } envelope. Everything else (which columns are searchable,
 * what a domain's rows look like, soft-delete semantics) stays in each
 * domain's own repository.ts, written out explicitly, so no domain's
 * behavior is hidden behind a shared generic engine (docs/PLAN.md
 * Pass 1: "not a shared generic CRUD engine that obscures what each
 * domain allows").
 */

export interface ListParams {
  page: number;
  pageSize: number;
  search?: string;
  sort?: string;
  status?: string;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parseListParams(query: Record<string, unknown>): ListParams {
  const page = Math.max(1, Number(query["page"] ?? 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query["page_size"] ?? 10) || 10));
  const search = typeof query["search"] === "string" && query["search"] ? query["search"] : undefined;
  const sort = typeof query["sort"] === "string" && query["sort"] ? query["sort"] : undefined;
  const status = typeof query["status"] === "string" && query["status"] ? query["status"] : undefined;
  return { page, pageSize, search, sort, status };
}

export function toListResult<T>(items: T[], total: number, params: ListParams): ListResult<T> {
  return { items, total, page: params.page, pageSize: params.pageSize };
}
