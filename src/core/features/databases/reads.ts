import type { FeatureContext } from "../../app/feature-context";
import { openRecord } from "./records";
import { database, fields, requireRecordDatabase } from "./repository";
import { listViews } from "./views";

/** A database with its fields and saved views: `GET /api/databases/:id`, and the first render of its address. */
export async function readDatabase(ctx: FeatureContext, id: string) {
  return { database: await database(ctx, id), fields: await fields(ctx, id), views: await listViews(ctx, id) };
}

/** One record of one database: `GET /api/databases/:id/records/:pageId`, and the first render of its address. */
export async function readRecord(ctx: FeatureContext, databaseId: string, pageId: string) {
  await requireRecordDatabase(ctx, databaseId, pageId);
  return openRecord(ctx, pageId);
}
