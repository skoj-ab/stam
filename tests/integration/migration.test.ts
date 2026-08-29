import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";

function invalidMigrations(root: string): string {
  const folder = join(root, "drizzle");
  mkdirSync(join(folder, "meta"), { recursive: true });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 1_700_000_000_000, tag: "0000_invalid", breakpoints: true },
      ],
    }),
  );
  writeFileSync(
    join(folder, "0000_invalid.sql"),
    [
      "CREATE TABLE parents (id TEXT PRIMARY KEY);",
      "--> statement-breakpoint",
      "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(id));",
      "--> statement-breakpoint",
      "INSERT INTO children (id, parent_id) VALUES ('child', 'missing-parent');",
    ].join("\n"),
  );
  return folder;
}

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{ tag: string }>;
};

function applicationMigrations(root: string, count: number): string {
  const source = resolve(import.meta.dir, "../../drizzle");
  const folder = join(root, "drizzle");
  const metadata = join(folder, "meta");
  mkdirSync(metadata, { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(source, "meta", "_journal.json"), "utf8"),
  ) as Journal;
  const selected = journal.entries.slice(0, count);
  writeFileSync(join(metadata, "_journal.json"), JSON.stringify({ ...journal, entries: selected }));
  for (const entry of selected) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

function insertLegacyCompany(
  database: ReturnType<typeof openDatabase>,
  id: string,
  registrationValue: string,
): void {
  database.sqlite.run(
    "INSERT INTO companies (id, legal_name, registration_country, registration_scheme, registration_value, status, created_at, created_by) VALUES (?, ?, 'SE', 'ORGANISATIONSNUMMER', ?, 'DRAFT', ?, ?)",
    [id, `${id} AB`, registrationValue, "2026-01-01T00:00:00.000Z", "migration-test"],
  );
}

describe("database migration transaction", () => {
  test("rolls back schema, data, and journal when foreign-key verification fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-invalid-migration-"));
    const database = openDatabase(join(directory, "stam.sqlite"));
    try {
      expect(() => migrateDatabase(database, invalidMigrations(directory))).toThrow(
        "Database migration left foreign-key violations",
      );
      const tables = database.sqlite
        .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => name);
      expect(tables).not.toContain("parents");
      expect(tables).not.toContain("children");
      expect(database.sqlite.query("SELECT * FROM __drizzle_migrations").all()).toEqual([]);
      expect(
        database.sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get(),
      ).toEqual({ foreign_keys: 1 });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("normalizes legacy dashed company identifiers", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-identifier-migration-"));
    const database = openDatabase(join(directory, "stam.sqlite"));
    try {
      migrateDatabase(database, applicationMigrations(directory, 3));
      insertLegacyCompany(database, "company-dashed", "556016-0680");
      migrateDatabase(database, applicationMigrations(directory, 4));
      expect(
        database.sqlite
          .query<{ registrationValue: string }, []>(
            "SELECT registration_value AS registrationValue FROM companies WHERE id = 'company-dashed'",
          )
          .get(),
      ).toEqual({ registrationValue: "5560160680" });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rolls back identifier migration when canonical values collide", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-identifier-collision-"));
    const database = openDatabase(join(directory, "stam.sqlite"));
    try {
      migrateDatabase(database, applicationMigrations(directory, 3));
      insertLegacyCompany(database, "company-dashed", "556016-0680");
      insertLegacyCompany(database, "company-plain", "5560160680");
      expect(
        database.sqlite
          .query<{ registrationValue: string }, []>(
            "SELECT registration_value AS registrationValue FROM companies ORDER BY id",
          )
          .all(),
      ).toEqual([{ registrationValue: "556016-0680" }, { registrationValue: "5560160680" }]);
      expect(() => migrateDatabase(database, applicationMigrations(directory, 4))).toThrow();
      expect(
        database.sqlite
          .query<{ registrationValue: string }, []>(
            "SELECT registration_value AS registrationValue FROM companies ORDER BY id",
          )
          .all(),
      ).toEqual([{ registrationValue: "556016-0680" }, { registrationValue: "5560160680" }]);
      expect(database.sqlite.query("SELECT * FROM __drizzle_migrations").all()).toHaveLength(3);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
