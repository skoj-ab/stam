import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { recordAuditEvent } from "../modules/audit/index.ts";
import { openDatabase } from "./database.ts";
import { sha256File, verifyDatabaseFile } from "./database-verification.ts";

export type BackupResult = Readonly<{
  destinationPath: string;
  size: number;
  sha256: string;
}>;

function serializeDatabase(path: string): Buffer {
  const database = new Database(path, { readonly: true, strict: true });
  try {
    return database.serialize();
  } finally {
    database.close();
  }
}

function writeVerifiedBackup(serialized: Buffer, temporaryPath: string, destination: string): void {
  try {
    writeFileSync(temporaryPath, serialized, { flag: "wx", mode: 0o600 });
    const descriptor = openSync(temporaryPath, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    verifyDatabaseFile(temporaryPath);

    if (existsSync(destination)) {
      throw new Error(`Backup destination already exists: ${destination}`);
    }
    renameSync(temporaryPath, destination);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function backupDatabase(sourcePath: string, destinationPath: string): BackupResult {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source === destination) {
    throw new Error("Backup source and destination must be different paths");
  }
  if (!existsSync(source)) {
    throw new Error(`Backup source does not exist: ${source}`);
  }
  if (existsSync(destination)) {
    throw new Error(`Backup destination already exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.tmp-${randomUUID()}`;
  const serialized = serializeDatabase(source);
  writeVerifiedBackup(serialized, temporaryPath, destination);
  const sha256 = sha256File(destination);
  const database = openDatabase(source);
  try {
    recordAuditEvent(database, {
      type: "BACKUP_OPERATION",
      outcome: "SUCCEEDED",
      actorKind: "SYSTEM",
      payload: {
        artifactName: basename(destination),
        sha256,
        size: serialized.byteLength,
      },
    });
  } finally {
    database.close();
  }
  return Object.freeze({ destinationPath: destination, size: serialized.byteLength, sha256 });
}
