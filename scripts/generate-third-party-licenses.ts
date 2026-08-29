import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type LicenseEntry = {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  author?: string;
  homepage?: string;
};

type PackageJson = {
  name?: string;
  version?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
};

const root = resolve(import.meta.dir, "..");
const outputDirectory = resolve(root, "dist/licenses");
const outputPath = resolve(outputDirectory, "JS-DEPENDENCIES.md");
const supplementalLicenses = new Map([
  ["drizzle-orm", resolve(root, "licenses/Drizzle-ORM-0.45.2-LICENSE.txt")],
  ["@better-auth/utils", resolve(root, "licenses/Better-Auth-Utils-LICENSE.txt")],
]);

function legalFiles(packagePath: string): string[] {
  return readdirSync(packagePath)
    .filter((name) => /^(?:licen[cs]e|notice|copying|copyright)(?:$|[._-])/i.test(name))
    .filter((name) => statSync(join(packagePath, name)).isFile())
    .sort();
}

function repositoryUrl(packageJson: PackageJson): string | undefined {
  if (typeof packageJson.repository === "string") return packageJson.repository;
  return packageJson.repository?.url ?? packageJson.homepage;
}

function isBuildOnlyMetadata(name: string): boolean {
  return (
    name === "@drizzle-team/brocli" ||
    name === "bun-types" ||
    name === "drizzle-kit" ||
    /^@esbuild\/linux-/.test(name) ||
    /^@rolldown\/binding-/.test(name)
  );
}

const command = Bun.spawnSync(["bun", "pm", "licenses", "--prod", "--json"], {
  cwd: root,
  stdout: "pipe",
  stderr: "inherit",
});

if (command.exitCode !== 0) throw new Error("bun pm licenses --prod --json failed");

const report = JSON.parse(command.stdout.toString()) as Record<string, LicenseEntry[]>;
const sections = new Map<string, string>();
const missing: string[] = [];

for (const [reportedLicense, entries] of Object.entries(report)) {
  for (const entry of entries) {
    for (const [index, packagePath] of entry.paths.entries()) {
      const packageJson = JSON.parse(
        readFileSync(join(packagePath, "package.json"), "utf8"),
      ) as PackageJson;
      const name = packageJson.name ?? entry.name;
      const version =
        packageJson.version ?? entry.versions[index] ?? entry.versions[0] ?? "unknown";
      const key = `${name}@${version}`;
      if (sections.has(key)) continue;

      let files = legalFiles(packagePath).map((filename) => ({
        filename,
        content: readFileSync(join(packagePath, filename), "utf8"),
      }));
      const supplementalPath = supplementalLicenses.get(name);
      if (files.length === 0 && supplementalPath) {
        files = [
          {
            filename: supplementalPath.split("/").at(-1) ?? "LICENSE",
            content: readFileSync(supplementalPath, "utf8"),
          },
        ];
      }
      // Bun reports installed optional peers under --prod. These packages are
      // build tools or platform bindings and are absent from the runtime image.
      if (files.length === 0 && isBuildOnlyMetadata(name)) continue;
      if (files.length === 0) {
        missing.push(key);
        continue;
      }

      const source = repositoryUrl(packageJson) ?? entry.homepage;
      const metadata = [
        `## ${key}`,
        "",
        `License: ${packageJson.license ?? entry.license ?? reportedLicense}`,
        source ? `Source: ${source}` : undefined,
        entry.author ? `Author: ${entry.author}` : undefined,
      ].filter((line): line is string => line !== undefined);
      const texts = files.flatMap(({ filename, content }) => [
        "",
        `### ${filename}`,
        "",
        content.trimEnd(),
      ]);
      sections.set(key, [...metadata, ...texts, ""].join("\n"));
    }
  }
}

if (missing.length > 0) {
  throw new Error(
    `Packages without legal files or reviewed fallbacks:\n${missing.sort().join("\n")}`,
  );
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  outputPath,
  [
    "# Production JavaScript dependency licenses",
    "",
    "Generated from the locked Bun installation. Do not edit manually.",
    "",
    ...[...sections.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, section]) => section),
  ].join("\n"),
);
