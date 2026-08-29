import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export type DatabaseVerification = Readonly<{
  sha256: string;
  size: number;
}>;

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertRegularFile(path: string): number {
  const file = statSync(path);
  if (!file.isFile()) throw new Error(`Database is not a regular file: ${path}`);
  return file.size;
}

function assertIntegrity(database: Database): void {
  const rows = database.query<Record<string, string>, []>("PRAGMA integrity_check").all();
  if (rows.length !== 1 || Object.values(rows[0] ?? {})[0] !== "ok") {
    throw new Error("Database integrity check failed");
  }
}

function assertForeignKeys(database: Database): void {
  if (database.query("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("Database foreign-key check failed");
  }
}

function assertMigrationHistory(database: Database): void {
  const migrations = database
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (!migrations) throw new Error("Database migration history is missing");
}

export function verifyDatabaseFile(path: string): DatabaseVerification {
  const size = assertRegularFile(path);
  const database = new Database(path, { readonly: true, strict: true });
  try {
    assertIntegrity(database);
    assertForeignKeys(database);
    assertMigrationHistory(database);
  } finally {
    database.close();
  }

  return Object.freeze({ sha256: sha256File(path), size });
}
