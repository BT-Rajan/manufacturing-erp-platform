/**
 * Admin-configurable field metadata. Each domain ships sane code
 * defaults (defaultFieldConfig in its schema.ts); an admin can override
 * is_required / is_searchable / is_filterable per field at runtime via
 * PUT /api/admin/field-config/:entityType, stored in the field_config
 * table. Absence of a row means "use the code default" -- nothing here
 * ever silently disables a field the domain code still expects to
 * exist; it only widens/narrows requiredness and list-query behavior.
 */

import { getDb } from "../../infrastructure/database/connection.js";

export interface FieldMeta {
  required: boolean;
  searchable: boolean;
  filterable: boolean;
}

export type FieldConfigDefaults = Record<string, FieldMeta>;

export async function getEffectiveFieldConfig(
  entityType: string,
  defaults: FieldConfigDefaults,
): Promise<FieldConfigDefaults> {
  const db = getDb();
  const overrides = await db
    .selectFrom("field_config")
    .selectAll()
    .where("entity_type", "=", entityType)
    .execute();

  const result: FieldConfigDefaults = structuredClone(defaults);
  for (const row of overrides) {
    const existing = result[row.field_name];
    if (!existing) continue; // ignore overrides for fields the domain no longer has
    result[row.field_name] = {
      required: row.is_required === null ? existing.required : Boolean(row.is_required),
      searchable: row.is_searchable === null ? existing.searchable : Boolean(row.is_searchable),
      filterable: row.is_filterable === null ? existing.filterable : Boolean(row.is_filterable),
    };
  }
  return result;
}

export interface FieldConfigUpdate {
  fieldName: string;
  isRequired?: boolean;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

export async function setFieldConfig(
  entityType: string,
  updates: FieldConfigUpdate[],
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  for (const update of updates) {
    const existing = await db
      .selectFrom("field_config")
      .selectAll()
      .where("entity_type", "=", entityType)
      .where("field_name", "=", update.fieldName)
      .executeTakeFirst();

    const values = {
      is_required: update.isRequired ?? existing?.is_required ?? null,
      is_searchable: update.isSearchable ?? existing?.is_searchable ?? null,
      is_filterable: update.isFilterable ?? existing?.is_filterable ?? null,
      updated_by: performedBy,
    };

    if (existing) {
      await db.updateTable("field_config").set(values).where("id", "=", existing.id).execute();
    } else {
      await db
        .insertInto("field_config")
        .values({ entity_type: entityType, field_name: update.fieldName, ...values })
        .execute();
    }
  }
}
