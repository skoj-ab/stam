import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { type DatabaseContext, openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import {
  applicationAuditEvents,
  companies,
  currentShareRanges,
  shareClasses,
  shareEvents,
  shareholders,
} from "../../src/db/schema.ts";
import {
  commitFortnoxImport,
  prepareFortnoxImport,
  previewFortnoxImport,
} from "../../src/modules/fortnox-import/index.ts";
import { syntheticFortnoxImport } from "../fixtures/fortnox.ts";

function withDatabase<T>(operation: (database: DatabaseContext) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "stam-fortnox-import-"));
  const database = openDatabase(join(directory, "stam.sqlite"));
  try {
    migrateDatabase(database);
    return operation(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Fortnox import persistence", () => {
  test("prepares a deterministic current-state plan", () => {
    const plan = prepareFortnoxImport(syntheticFortnoxImport);

    expect(plan.company).toMatchObject({
      legalName: "Exempelimport AB",
      registrationValue: "5560160680",
      exportDate: "2026-08-28",
    });
    expect(plan.shareClass).toEqual({
      name: "A",
      votesPerShare: "1",
      totalShares: 3,
      totalVotes: "3",
    });
    expect(plan.shareCapital).toEqual({ amount: "30", currency: "SEK" });
    expect(plan.shareholders.map(({ kind }) => kind).sort()).toEqual([
      "INDIVIDUAL",
      "LEGAL_ENTITY",
    ]);
    expect(plan.holdings.flatMap(({ ranges }) => ranges)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 3 },
    ]);
    expect(plan.sourceEvents).toHaveLength(2);
    expect(plan.analysis.warnings).toMatchObject([{ code: "UNSUPPORTED_EVENT_TYPE" }]);
  });

  test("previews without writes and commits the complete bootstrap atomically", () => {
    withDatabase((database) => {
      const preview = previewFortnoxImport({
        database,
        input: syntheticFortnoxImport,
        actorUserId: "user-1",
      });
      expect(preview.currentSnapshot.holdings).toHaveLength(2);
      expect(database.db.select().from(companies).all()).toHaveLength(0);
      expect(database.db.select().from(shareEvents).all()).toHaveLength(0);

      const result = commitFortnoxImport({
        database,
        input: syntheticFortnoxImport,
        actorUserId: "user-1",
      });
      expect(result.company.status).toBe("ACTIVE");
      expect(result.shareholders).toHaveLength(2);
      expect(result.shareClasses).toHaveLength(1);
      expect(result.events.map(({ type }) => type)).toEqual([
        "SOURCE_ACTIVITY_RECORDED",
        "SOURCE_ACTIVITY_RECORDED",
        "SHARE_CAPITAL_CHANGED",
        "OPENING_STATE_IMPORTED",
      ]);
      expect(new Set(result.events.map(({ operationId }) => operationId))).toHaveLength(1);
      expect(String(result.currentSnapshot.shareCapital?.amount)).toBe("30");
      expect(result.currentSnapshot.shareCapital?.currency).toBe("SEK");
      expect(result.currentSnapshot.totalsByClass[0]?.total).toBe(3);
      expect(database.db.select().from(shareholders).all()).toHaveLength(2);
      expect(database.db.select().from(shareClasses).all()).toHaveLength(1);
      expect(database.db.select().from(currentShareRanges).all()).toHaveLength(2);
      expect(() =>
        database.db
          .update(shareEvents)
          .set({ effectiveDate: "2026-08-27" })
          .where(eq(shareEvents.id, result.events[0]?.id ?? ""))
          .run(),
      ).toThrow("share_events are immutable");

      const audit = database.db
        .select()
        .from(applicationAuditEvents)
        .where(eq(applicationAuditEvents.type, "IMPORT_COMMITTED"))
        .all();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        companyId: result.company.id,
        operationId: result.events[0]?.operationId,
        payload: {
          kind: "OPENING_FORTNOX",
          shareholderCount: 2,
          sourceEventCount: 2,
        },
      });
      expect(JSON.stringify(audit)).not.toContain(syntheticFortnoxImport.eventsHtml);
    });
  });

  test("rolls back catalogs when a late event insert fails", () => {
    withDatabase((database) => {
      database.sqlite.run(`
        CREATE TRIGGER reject_fortnox_opening
        BEFORE INSERT ON share_events
        WHEN NEW.type = 'OPENING_STATE_IMPORTED'
        BEGIN
          SELECT RAISE(ABORT, 'forced import failure');
        END
      `);

      expect(() =>
        commitFortnoxImport({
          database,
          input: syntheticFortnoxImport,
          actorUserId: "user-1",
        }),
      ).toThrow("forced import failure");
      expect(database.db.select().from(companies).all()).toHaveLength(0);
      expect(database.db.select().from(shareholders).all()).toHaveLength(0);
      expect(database.db.select().from(shareClasses).all()).toHaveLength(0);
      expect(database.db.select().from(shareEvents).all()).toHaveLength(0);
      expect(database.db.select().from(currentShareRanges).all()).toHaveLength(0);
      expect(database.db.select().from(applicationAuditEvents).all()).toHaveLength(0);
    });
  });
});
