import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import { shareClasses } from "../../db/schema.ts";
import {
  effectiveDateSchema,
  exactDecimalSchema,
  parseShareClass,
  type ShareClass,
} from "../../domain/share-register/index.ts";
import { requireCompany } from "../companies/index.ts";

const nonemptyStringSchema = z.string().trim().min(1);

export const createShareClassInputSchema = z
  .object({
    companyId: nonemptyStringSchema,
    name: nonemptyStringSchema,
    votesPerShare: exactDecimalSchema,
    effectiveFrom: effectiveDateSchema,
  })
  .strict();

export type CreateShareClassInput = z.input<typeof createShareClassInputSchema>;

function rowToShareClass(row: typeof shareClasses.$inferSelect): ShareClass {
  return parseShareClass(row);
}

export function getShareClass(
  database: DatabaseContext,
  shareClassId: string,
): ShareClass | undefined {
  const row = database.db
    .select()
    .from(shareClasses)
    .where(eq(shareClasses.id, shareClassId))
    .get();
  return row ? rowToShareClass(row) : undefined;
}

export function listShareClasses(
  database: DatabaseContext,
  companyId: string,
): readonly ShareClass[] {
  requireCompany(database, companyId);
  return Object.freeze(
    database.db
      .select()
      .from(shareClasses)
      .where(eq(shareClasses.companyId, companyId))
      .orderBy(asc(shareClasses.name), asc(shareClasses.id))
      .all()
      .map(rowToShareClass),
  );
}

export function createShareClass(
  database: DatabaseContext,
  input: CreateShareClassInput,
  registeredBy: string,
): ShareClass {
  const values = createShareClassInputSchema.parse(input);
  const caller = nonemptyStringSchema.parse(registeredBy);
  requireCompany(database, values.companyId);
  const shareClass = parseShareClass({
    id: randomUUID(),
    ...values,
    registeredAt: new Date().toISOString(),
    registeredBy: caller,
  });

  database.db.insert(shareClasses).values(shareClass).run();
  return shareClass;
}
