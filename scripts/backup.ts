import { backupDatabase } from "../src/db/backup.ts";

function readOutputPath(args: readonly string[]): string {
  if (args.length === 0 && Bun.env.STAM_BACKUP_PATH) return Bun.env.STAM_BACKUP_PATH;
  if (args.length === 2 && args[0] === "--output" && args[1]) return args[1];
  throw new Error("Usage: bun run db:backup --output <path> (or configure STAM_BACKUP_PATH)");
}

const sourcePath = Bun.env.DATABASE_PATH ?? "./data/stam.sqlite";
const result = backupDatabase(sourcePath, readOutputPath(Bun.argv.slice(2)));
console.info(
  `Backup written to ${result.destinationPath} (${result.size} bytes, sha256 ${result.sha256})`,
);
