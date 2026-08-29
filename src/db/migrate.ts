import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { DatabaseContext } from "./database.ts";

type Migration = ReturnType<typeof readMigrationFiles>[number];

function pendingMigrations(database: DatabaseContext, migrationsFolder: string): Migration[] {
  database.sqlite.run(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);
  const latest = database.sqlite
    .query<{ createdAt: number }, []>(
      "SELECT created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    )
    .get();
  return readMigrationFiles({ migrationsFolder }).filter(
    (migration) => !latest || latest.createdAt < migration.folderMillis,
  );
}

function applyPendingMigrations(database: DatabaseContext, pending: readonly Migration[]): void {
  if (pending.length === 0) return;

  database.sqlite.run("BEGIN");
  try {
    for (const migration of pending) {
      for (const source of migration.sql) {
        const statement = source.trim();
        if (statement) database.sqlite.run(statement);
      }
    }
    if (database.sqlite.query("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("Database migration left foreign-key violations");
    }
    const recordMigration = database.sqlite.query(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    );
    for (const migration of pending) recordMigration.run(migration.hash, migration.folderMillis);
    database.sqlite.run("COMMIT");
  } catch (error) {
    database.sqlite.run("ROLLBACK");
    throw error;
  }
}

function applyMigrations(database: DatabaseContext, migrationsFolder: string): void {
  applyPendingMigrations(database, pendingMigrations(database, migrationsFolder));
}

export function migrateDatabase(database: DatabaseContext, migrationsFolder?: string): void {
  const resolvedFolder =
    migrationsFolder ??
    [
      resolve(import.meta.dir, "drizzle"),
      resolve(import.meta.dir, "../../drizzle"),
      resolve(process.cwd(), "drizzle"),
    ].find((candidate) => existsSync(resolve(candidate, "meta/_journal.json")));
  if (!resolvedFolder) {
    throw new Error("Could not locate database migrations");
  }

  // SQLite only allows foreign-key enforcement to be toggled outside a transaction.
  database.sqlite.run("PRAGMA foreign_keys = OFF");
  try {
    applyMigrations(database, resolvedFolder);
  } finally {
    database.sqlite.run("PRAGMA foreign_keys = ON");
  }
}
