import { type RestoreOptions, restoreDatabase } from "../src/db/restore.ts";

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function parseArgs(args: readonly string[]): RestoreOptions {
  const values: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--verify-only" || flag === "--replace") {
      if (values[flag]) throw new Error(`Duplicate argument: ${flag}`);
      values[flag] = true;
      continue;
    }
    if (["--input", "--expected-sha256", "--operator", "--reason"].includes(flag ?? "")) {
      if (values[flag ?? ""]) throw new Error(`Duplicate argument: ${flag}`);
      values[flag ?? ""] = readValue(args, index, flag ?? "");
      index += 1;
      continue;
    }
    throw new Error(`Unknown restore argument: ${flag ?? ""}`);
  }

  const sourcePath = String(values["--input"] ?? Bun.env.STAM_RESTORE_PATH ?? "");
  if (!sourcePath) {
    throw new Error(
      "Usage: bun run db:restore --input <backup.sqlite> [--verify-only | --replace]",
    );
  }
  return {
    sourcePath,
    targetPath: Bun.env.DATABASE_PATH ?? "./data/stam.sqlite",
    expectedSha256:
      String(values["--expected-sha256"] ?? Bun.env.STAM_RESTORE_SHA256 ?? "") || undefined,
    replace: values["--replace"] === true,
    verifyOnly: values["--verify-only"] === true,
    operator: String(values["--operator"] ?? "") || undefined,
    reason: String(values["--reason"] ?? "") || undefined,
  };
}

const result = restoreDatabase(parseArgs(Bun.argv.slice(2)));
console.info(JSON.stringify(result));
