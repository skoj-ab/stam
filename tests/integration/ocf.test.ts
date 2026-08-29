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
  shareClasses,
  shareEvents,
  shareholders,
} from "../../src/db/schema.ts";
import { exportOcfPackage } from "../../src/modules/ocf/export.ts";
import {
  commitOcfImport,
  exportCompanyOcfPackage,
  previewOcfImport,
} from "../../src/modules/ocf/index.ts";
import { ocfExportSource } from "../modules/ocf-fixture.ts";

const actorUserId = "ocf-integration-user";
const transferReasonResolutions = { "transfer-1": { reason: "SALE" as const } };

function withDatabase(operation: (database: DatabaseContext) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "stam-ocf-"));
  const database = openDatabase(join(directory, "stam.sqlite"));
  try {
    migrateDatabase(database);
    operation(database);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function importRequest() {
  const exported = exportOcfPackage(ocfExportSource(), {
    generatedAt: "2024-12-31T12:00:00Z",
  });
  if (!exported.package) throw new Error(JSON.stringify(exported.report.issues));
  return {
    package: exported.package,
    options: { mode: "TRANSACTION_HISTORY" as const, transferReasonResolutions },
  };
}

function cancellationReason(pkg: unknown): unknown {
  const files = (pkg as { files?: Record<string, unknown> } | undefined)?.files;
  const transactions = files?.["./Transactions.ocf.json"] as
    | { items?: Array<Record<string, unknown>> }
    | undefined;
  return transactions?.items?.find((item) => item.object_type === "TX_STOCK_CANCELLATION")
    ?.reason_text;
}

describe("OCF application integration", () => {
  test("previews without writes and commits the complete import atomically", () => {
    withDatabase((database) => {
      const request = importRequest();
      const preview = previewOcfImport(request);
      expect(preview.report.valid).toBe(true);
      expect(database.db.select().from(companies).all()).toEqual([]);
      expect(database.db.select().from(applicationAuditEvents).all()).toEqual([]);

      const result = commitOcfImport(database, request, actorUserId);
      expect(result.company.status).toBe("ACTIVE");
      expect(result.currentSnapshot.holdings).toEqual([
        expect.objectContaining({ range: { from: 1, to: 6 } }),
        expect.objectContaining({ range: { from: 9, to: 10 } }),
      ]);
      expect(result.shareholders).toHaveLength(2);
      expect(result.shareClasses).toHaveLength(1);
      expect(result.events.map((event) => event.type)).toEqual([
        "OPENING_STATE_IMPORTED",
        "SHARES_ISSUED",
        "SHARES_TRANSFERRED",
        "SHARES_CANCELLED",
      ]);
      expect(database.db.select().from(companies).all()).toHaveLength(1);
      expect(database.db.select().from(shareholders).all()).toHaveLength(2);
      expect(database.db.select().from(shareClasses).all()).toHaveLength(1);
      expect(database.db.select().from(shareEvents).all()).toHaveLength(4);
      expect(
        database.db.select().from(companies).where(eq(companies.id, result.company.id)).get()
          ?.status,
      ).toBe("ACTIVE");

      const audit = database.db
        .select()
        .from(applicationAuditEvents)
        .where(eq(applicationAuditEvents.type, "IMPORT_COMMITTED"))
        .get();
      expect(audit?.payload).toMatchObject({ kind: "OCF_V1_2_0", ocfVersion: "1.2.0" });
      expect(JSON.stringify(audit)).not.toContain("Anna Andersson");
      expect(JSON.stringify(audit)).not.toContain("8507099805");
    });
  });

  test("rolls back catalogs and company when a late audit write fails", () => {
    withDatabase((database) => {
      database.sqlite.run(`
        CREATE TRIGGER reject_ocf_import_audit
        BEFORE INSERT ON application_audit_events
        WHEN NEW.type = 'IMPORT_COMMITTED'
        BEGIN
          SELECT RAISE(ABORT, 'forced OCF import failure');
        END
      `);
      expect(() => commitOcfImport(database, importRequest(), actorUserId)).toThrow(
        "forced OCF import failure",
      );
      expect(database.db.select().from(companies).all()).toEqual([]);
      expect(database.db.select().from(shareholders).all()).toEqual([]);
      expect(database.db.select().from(shareClasses).all()).toEqual([]);
      expect(database.db.select().from(shareEvents).all()).toEqual([]);
      expect(database.db.select().from(applicationAuditEvents).all()).toEqual([]);
    });
  });

  test("exports a committed supported history and records only safe metadata", () => {
    withDatabase((database) => {
      const imported = commitOcfImport(database, importRequest(), actorUserId);
      const shareClass = imported.shareClasses[0];
      if (!shareClass) throw new Error("Expected imported share class");
      const result = exportCompanyOcfPackage(
        database,
        imported.company.id,
        {
          formationDate: "2019-01-01",
          asOf: "2024-12-31",
          stockClasses: {
            [shareClass.id]: {
              classType: "COMMON",
              defaultIdPrefix: "A-",
              initialSharesAuthorized: "1000",
              seniority: "1",
            },
          },
        },
        actorUserId,
      );

      expect(result.report.valid).toBe(true);
      expect(result.package?.manifest).toMatchObject({ ocf_version: "1.2.0" });
      expect(result.report.losses.map((entry) => entry.code)).toContain(
        "STAM_TRANSFER_REASON_NOT_IN_OCF",
      );
      expect(cancellationReason(result.package)).toBe("Bolagsstämmans beslut");
      const exports = database.db
        .select()
        .from(applicationAuditEvents)
        .where(eq(applicationAuditEvents.type, "EXPORT_GENERATED"))
        .all();
      expect(exports).toHaveLength(1);
      expect(exports[0]?.payload).toMatchObject({ format: "OCF_1_2_0", asOf: "2024-12-31" });
      expect(JSON.stringify(exports)).not.toContain("Anna Andersson");
    });
  });
});
