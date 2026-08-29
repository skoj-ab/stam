import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase } from "../../src/db/backup.ts";
import { openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { restoreDatabase } from "../../src/db/restore.ts";
import { listAuditEvents } from "../../src/modules/audit/index.ts";
import { createCompany } from "../../src/modules/companies/index.ts";

function createDatabase(path: string, legalName: string, registrationValue: string): void {
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    createCompany(
      database,
      {
        legalName,
        registrationCountry: "SE",
        registrationScheme: "ORGANISATIONSNUMMER",
        registrationValue,
      },
      "restore-test-user",
    );
  } finally {
    database.close();
  }
}

describe("verified database restore", () => {
  test("verifies, preserves, migrates, and atomically replaces a database", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-restore-integration-"));
    const sourceDatabase = join(directory, "source.sqlite");
    const backupPath = join(directory, "backup.sqlite");
    const targetPath = join(directory, "target.sqlite");

    try {
      createDatabase(sourceDatabase, "Restored AB", "550000-0004");
      const backup = backupDatabase(sourceDatabase, backupPath);
      createDatabase(targetPath, "Replaced AB", "550000-0012");

      const verified = restoreDatabase({
        sourcePath: backupPath,
        targetPath,
        expectedSha256: backup.sha256,
        verifyOnly: true,
      });
      expect(verified.verifiedOnly).toBe(true);

      const restored = restoreDatabase({
        sourcePath: backupPath,
        targetPath,
        expectedSha256: backup.sha256,
        replace: true,
        operator: "integration-test",
        reason: "restore verification",
      });
      expect(restored.verifiedOnly).toBe(false);
      expect(restored.installedSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(restored.preservationPath && existsSync(restored.preservationPath)).toBe(true);

      const database = openDatabase(targetPath);
      try {
        expect(
          database.sqlite
            .query<{ legal_name: string }, []>("SELECT legal_name FROM companies")
            .all(),
        ).toEqual([{ legal_name: "Restored AB" }]);
        expect(listAuditEvents(database).at(-1)).toMatchObject({
          type: "RESTORE_OPERATION",
          outcome: "SUCCEEDED",
        });
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects corrupt data and digest mismatches without changing the target", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-restore-rejection-"));
    const targetPath = join(directory, "target.sqlite");
    const corruptPath = join(directory, "corrupt.sqlite");
    try {
      createDatabase(targetPath, "Original AB", "550000-0012");
      Bun.write(corruptPath, "not a sqlite database");
      expect(() =>
        restoreDatabase({ sourcePath: corruptPath, targetPath, verifyOnly: true }),
      ).toThrow();

      const database = new Database(targetPath, { readonly: true, strict: true });
      try {
        expect(
          database.query<{ legal_name: string }, []>("SELECT legal_name FROM companies").get(),
        ).toEqual({ legal_name: "Original AB" });
      } finally {
        database.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
