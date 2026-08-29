import { asc, eq } from "drizzle-orm";
import type { DatabaseContext } from "../../db/database.ts";
import { shareClasses, shareEvents, shareholders } from "../../db/schema.ts";
import {
  parseShareClass,
  parseShareholder,
  parseShareRegisterEvent,
  type ShareClass,
  type Shareholder,
  type ShareRegisterEvent,
} from "../../domain/share-register/index.ts";
import { requireCompany } from "../companies/index.ts";

export type PersistedShareRegister = Readonly<{
  companyId: string;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  events: readonly ShareRegisterEvent[];
}>;

export function loadShareRegister(
  database: DatabaseContext,
  companyId: string,
): PersistedShareRegister {
  requireCompany(database, companyId);
  const shareholderRows = database.db
    .select()
    .from(shareholders)
    .where(eq(shareholders.companyId, companyId))
    .orderBy(asc(shareholders.registeredAt), asc(shareholders.id))
    .all();
  const shareClassRows = database.db
    .select()
    .from(shareClasses)
    .where(eq(shareClasses.companyId, companyId))
    .orderBy(asc(shareClasses.registeredAt), asc(shareClasses.id))
    .all();
  const eventRows = database.db
    .select()
    .from(shareEvents)
    .where(eq(shareEvents.companyId, companyId))
    .orderBy(asc(shareEvents.sequence))
    .all();

  return Object.freeze({
    companyId,
    shareholders: Object.freeze(shareholderRows.map(parseShareholder)),
    shareClasses: Object.freeze(shareClassRows.map(parseShareClass)),
    events: Object.freeze(
      eventRows.map(({ reversalTargetId: _reversalTargetId, ...event }) =>
        parseShareRegisterEvent(event),
      ),
    ),
  });
}
