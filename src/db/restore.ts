import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { recordAuditEvent } from "../modules/audit/index.ts";
import { backupDatabase } from "./backup.ts";
import { openDatabase } from "./database.ts";
import { type DatabaseVerification, verifyDatabaseFile } from "./database-verification.ts";
import { migrateDatabase } from "./migrate.ts";

export type RestoreOptions = Readonly<{
  sourcePath: string;
  targetPath: string;
  expectedSha256?: string;
  replace?: boolean;
  verifyOnly?: boolean;
  operator?: string;
  reason?: string;
}>;

export type RestoreResult = Readonly<{
  sourcePath: string;
  targetPath: string;
  sourceSha256: string;
  installedSha256?: string;
  size: number;
  preservationPath?: string;
  verifiedOnly: boolean;
}>;

type RestorePaths = Readonly<{ source: string; target: string }>;
type RestoreContext = Readonly<{
  options: RestoreOptions;
  paths: RestorePaths;
  sourceVerification: DatabaseVerification;
}>;

function syncPath({ path }: { path: string }): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function preservationPath({ target }: RestorePaths): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${target}.pre-restore-${timestamp}-${randomUUID()}.sqlite`;
}

function assertRestoreOptions(options: RestoreOptions): void {
  if (!options.verifyOnly && !options.operator?.trim()) {
    throw new Error("Restore replacement requires --operator");
  }
  if (options.expectedSha256 && !/^[a-f0-9]{64}$/i.test(options.expectedSha256)) {
    throw new Error("Expected SHA-256 must contain 64 hexadecimal characters");
  }
}

function assertDistinctPaths({ source, target }: RestorePaths): void {
  if (source === target) throw new Error("Restore source and target must be different paths");
  if (!existsSync(source)) throw new Error(`Restore source does not exist: ${source}`);
}

function verifySource({
  options,
  paths,
}: {
  options: RestoreOptions;
  paths: RestorePaths;
}): DatabaseVerification {
  const { source } = paths;
  const verification = verifyDatabaseFile(source);
  if (
    options.expectedSha256 &&
    verification.sha256.toLowerCase() !== options.expectedSha256.toLowerCase()
  ) {
    throw new Error("Restore source SHA-256 does not match the expected digest");
  }
  return verification;
}

function assertReplaceAllowed({
  options,
  paths,
}: Omit<RestoreContext, "sourceVerification">): void {
  if (existsSync(paths.target) && !options.replace) {
    throw new Error("Restore target exists; pass --replace after stopping Stam");
  }
}

function stageDatabase({ source, target }: RestorePaths): string {
  const staging = `${target}.restore-${randomUUID()}.tmp`;
  try {
    copyFileSync(source, staging, constants.COPYFILE_EXCL);
    chmodSync(staging, 0o600);
    syncPath({ path: staging });

    const stagedDatabase = openDatabase(staging);
    try {
      migrateDatabase(stagedDatabase);
    } finally {
      stagedDatabase.close();
    }
    verifyDatabaseFile(staging);
    return staging;
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}

function preserveTarget(paths: RestorePaths): string | undefined {
  if (!existsSync(paths.target)) return undefined;
  const preserved = preservationPath(paths);
  backupDatabase(paths.target, preserved);
  return preserved;
}

function installStagedDatabase({ staging, paths }: { staging: string; paths: RestorePaths }): void {
  rmSync(`${paths.target}-wal`, { force: true });
  rmSync(`${paths.target}-shm`, { force: true });
  renameSync(staging, paths.target);
  syncPath({ path: dirname(paths.target) });
}

function auditRestore(
  { options, paths, sourceVerification }: RestoreContext,
  { preserved }: { preserved: string | undefined },
): void {
  const database = openDatabase(paths.target);
  try {
    recordAuditEvent(database, {
      type: "RESTORE_OPERATION",
      outcome: "SUCCEEDED",
      actorKind: "SYSTEM",
      payload: {
        operator: options.operator?.trim(),
        reason: options.reason?.trim() || undefined,
        sourceArtifact: basename(paths.source),
        sourceSha256: sourceVerification.sha256,
        preservationArtifact: preserved ? basename(preserved) : undefined,
      },
    });
  } finally {
    database.close();
  }
}

function installRestore(context: RestoreContext): RestoreResult {
  const { paths, sourceVerification } = context;
  mkdirSync(dirname(paths.target), { recursive: true });
  const staging = stageDatabase(paths);
  try {
    const preserved = preserveTarget(paths);
    installStagedDatabase({ staging, paths });
    auditRestore(context, { preserved });
    const installed = verifyDatabaseFile(paths.target);
    return Object.freeze({
      sourcePath: paths.source,
      targetPath: paths.target,
      sourceSha256: sourceVerification.sha256,
      installedSha256: installed.sha256,
      size: installed.size,
      preservationPath: preserved,
      verifiedOnly: false,
    });
  } finally {
    rmSync(staging, { force: true });
  }
}

export function restoreDatabase(options: RestoreOptions): RestoreResult {
  assertRestoreOptions(options);
  const paths = Object.freeze({
    source: resolve(options.sourcePath),
    target: resolve(options.targetPath),
  });
  assertDistinctPaths(paths);
  const verification = verifySource({ options, paths });
  if (options.verifyOnly) {
    return Object.freeze({
      sourcePath: paths.source,
      targetPath: paths.target,
      sourceSha256: verification.sha256,
      size: verification.size,
      verifiedOnly: true,
    });
  }
  const context = Object.freeze({ options, paths, sourceVerification: verification });
  assertReplaceAllowed(context);
  return installRestore(context);
}
