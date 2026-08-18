import { sql } from "kysely";

import { getDb } from "../../infrastructure/database/connection.js";

export async function findById(id: number, includeDeleted = false) {
  const db = getDb();
  let query = db.selectFrom("calendar_events").selectAll().where("id", "=", id);
  if (!includeDeleted) query = query.where("deleted_at", "is", null);
  return query.executeTakeFirst();
}

export async function getMentionedUserIds(eventId: number): Promise<number[]> {
  const db = getDb();
  const rows = await db.selectFrom("calendar_event_mentions").select("user_id").where("event_id", "=", eventId).execute();
  return rows.map((r) => r.user_id);
}

export async function listInRange(from: string, to: string, userId: number) {
  const db = getDb();
  return db
    .selectFrom("calendar_events")
    .leftJoin("calendar_event_mentions", "calendar_event_mentions.event_id", "calendar_events.id")
    .select([
      "calendar_events.id",
      "calendar_events.event_date",
      "calendar_events.title",
      "calendar_events.notes",
      "calendar_events.all_users",
      "calendar_events.created_by",
      "calendar_events.created_at",
    ])
    .distinct()
    .where("calendar_events.deleted_at", "is", null)
    .where("calendar_events.event_date", ">=", new Date(`${from}T00:00:00.000Z`))
    .where("calendar_events.event_date", "<=", new Date(`${to}T00:00:00.000Z`))
    .where((eb) =>
      eb.or([
        eb("calendar_events.all_users", "=", true),
        eb("calendar_events.created_by", "=", userId),
        eb("calendar_event_mentions.user_id", "=", userId),
      ]),
    )
    .orderBy("calendar_events.event_date", "asc")
    .execute();
}

export async function create(
  values: { event_date: string; title: string; notes: string | null; all_users: boolean },
  mentionedUserIds: number[],
  performedBy: number | null,
) {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const result = await trx
      .insertInto("calendar_events")
      .values({ ...values, created_by: performedBy, updated_by: performedBy })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);
    if (mentionedUserIds.length > 0) {
      await trx
        .insertInto("calendar_event_mentions")
        .values(mentionedUserIds.map((userId) => ({ event_id: id, user_id: userId })))
        .execute();
    }
    return id;
  });
}

export async function update(
  id: number,
  values: Partial<{ event_date: string; title: string; notes: string | null; all_users: boolean }>,
  mentionedUserIds: number[] | undefined,
  performedBy: number | null,
): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    if (Object.keys(values).length > 0) {
      await trx
        .updateTable("calendar_events")
        .set({ ...values, updated_by: performedBy })
        .where("id", "=", id)
        .execute();
    }
    if (mentionedUserIds !== undefined) {
      await trx.deleteFrom("calendar_event_mentions").where("event_id", "=", id).execute();
      if (mentionedUserIds.length > 0) {
        await trx
          .insertInto("calendar_event_mentions")
          .values(mentionedUserIds.map((userId) => ({ event_id: id, user_id: userId })))
          .execute();
      }
    }
  });
}

export async function softDelete(id: number, performedBy: number | null): Promise<void> {
  const db = getDb();
  await db
    .updateTable("calendar_events")
    .set({ deleted_at: sql`CURRENT_TIMESTAMP`, updated_by: performedBy })
    .where("id", "=", id)
    .execute();
}
