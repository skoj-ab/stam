import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase } from "../../src/db/backup.ts";
import { openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { listAuditEvents } from "../../src/modules/audit/index.ts";
import { createCompany } from "../../src/modules/companies/index.ts";

describe("SQLite online backup", () => {
  test("captures committed application data from a live WAL database", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-backup-integration-"));
    const sourcePath = join(directory, "live.sqlite");
    const destinationPath = join(directory, "backups", "stam.sqlite");
    const source = openDatabase(sourcePath);

    try {
      migrateDatabase(source);
      source.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
      source.sqlite.run("PRAGMA wal_autocheckpoint = 0");
      const company = createCompany(
        source,
        {
          legalName: "Backup Proof AB",
          registrationCountry: "SE",
          registrationScheme: "ORGANISATIONSNUMMER",
          registrationValue: "550000-0004",
        },
        "backup-test-user",
      );

      expect(source.sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(statSync(`${sourcePath}-wal`).size).toBeGreaterThan(0);

      const result = backupDatabase(sourcePath, destinationPath);
      expect(result.destinationPath).toBe(destinationPath);
      expect(result.size).toBeGreaterThan(0);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(destinationPath)).toBe(true);
      expect(listAuditEvents(source).at(-1)).toMatchObject({
        type: "BACKUP_OPERATION",
        outcome: "SUCCEEDED",
      });

      const backup = new Database(destinationPath, { readonly: true, strict: true });
      try {
        expect(backup.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
        expect(
          backup
            .query<{ id: string; legal_name: string }, { id: string }>(
              "SELECT id, legal_name FROM companies WHERE id = $id",
            )
            .get({ id: company.id }),
        ).toEqual({ id: company.id, legal_name: "Backup Proof AB" });
      } finally {
        backup.close();
      }

      expect(() => backupDatabase(sourcePath, destinationPath)).toThrow("already exists");
      expect(() => backupDatabase(sourcePath, sourcePath)).toThrow(
        "source and destination must be different",
      );
    } finally {
      source.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
