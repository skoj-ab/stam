import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const outputDirectory = resolve(import.meta.dir, "../dist/server");
const entrypoints = [
  ["index.js", resolve(import.meta.dir, "../src/server/index.ts")],
  ["bootstrap-admin.js", resolve(import.meta.dir, "bootstrap-admin.ts")],
  ["backup.js", resolve(import.meta.dir, "backup.ts")],
  ["restore.js", resolve(import.meta.dir, "restore.ts")],
] as const;

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

for (const [outputName, entrypoint] of entrypoints) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    naming: outputName,
    outdir: outputDirectory,
    target: "bun",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Failed to build ${entrypoint}`);
  }
}

cpSync(resolve(import.meta.dir, "../drizzle"), resolve(outputDirectory, "drizzle"), {
  recursive: true,
});
cpSync(
  resolve(import.meta.dir, "../src/modules/share-register-exports/share-register.typ"),
  resolve(outputDirectory, "share-register.typ"),
);
cpSync(resolve(import.meta.dir, "../licenses"), resolve(outputDirectory, "licenses"), {
  recursive: true,
});

const require = createRequire(import.meta.url);
const ocfPackageRoot = dirname(require.resolve("open-cap-format-ocf/package.json"));
cpSync(resolve(ocfPackageRoot, "schema"), resolve(outputDirectory, "ocf-schema"), {
  recursive: true,
});
