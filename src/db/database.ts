import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type StamDatabase = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseContext = Readonly<{
  sqlite: Database;
  db: StamDatabase;
  close: () => void;
}>;

function ensureDatabaseDirectory(path: string): void {
  if (path === ":memory:") {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
}

export function openDatabase(path: string): DatabaseContext {
  ensureDatabaseDirectory(path);
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = FULL");
  sqlite.run("PRAGMA busy_timeout = 5000");

  let closed = false;
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (path !== ":memory:") {
        sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
      }
      sqlite.close();
    },
  };
}

export function withImmediateTransaction<T>(sqlite: Database, operation: () => T): T {
  sqlite.run("BEGIN IMMEDIATE");
  try {
    const result = operation();
    sqlite.run("COMMIT");
    return result;
  } catch (error) {
    sqlite.run("ROLLBACK");
    throw error;
  }
}
