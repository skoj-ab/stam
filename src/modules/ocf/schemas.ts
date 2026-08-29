import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { JsonValue, OcfIssue, OcfPackage } from "./types.ts";

const SCHEMA_BASE = "https://schema.opencaptablecoalition.com/v/1.2.0";
const FILE_SCHEMA_IDS: Readonly<Record<string, string>> = Object.freeze({
  OCF_MANIFEST_FILE: `${SCHEMA_BASE}/files/OCFManifestFile.schema.json`,
  OCF_STAKEHOLDERS_FILE: `${SCHEMA_BASE}/files/StakeholdersFile.schema.json`,
  OCF_STOCK_CLASSES_FILE: `${SCHEMA_BASE}/files/StockClassesFile.schema.json`,
  OCF_STOCK_LEGEND_TEMPLATES_FILE: `${SCHEMA_BASE}/files/StockLegendTemplatesFile.schema.json`,
  OCF_STOCK_PLANS_FILE: `${SCHEMA_BASE}/files/StockPlansFile.schema.json`,
  OCF_TRANSACTIONS_FILE: `${SCHEMA_BASE}/files/TransactionsFile.schema.json`,
  OCF_VALUATIONS_FILE: `${SCHEMA_BASE}/files/ValuationsFile.schema.json`,
  OCF_VESTING_TERMS_FILE: `${SCHEMA_BASE}/files/VestingTermsFile.schema.json`,
  OCF_FINANCINGS_FILE: `${SCHEMA_BASE}/files/FinancingsFile.schema.json`,
  OCF_DOCUMENTS_FILE: `${SCHEMA_BASE}/files/DocumentsFile.schema.json`,
});
const MANIFEST_FILE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  stock_plans_files: "OCF_STOCK_PLANS_FILE",
  stock_legend_templates_files: "OCF_STOCK_LEGEND_TEMPLATES_FILE",
  stock_classes_files: "OCF_STOCK_CLASSES_FILE",
  vesting_terms_files: "OCF_VESTING_TERMS_FILE",
  valuations_files: "OCF_VALUATIONS_FILE",
  transactions_files: "OCF_TRANSACTIONS_FILE",
  stakeholders_files: "OCF_STAKEHOLDERS_FILE",
  financings_files: "OCF_FINANCINGS_FILE",
  documents_files: "OCF_DOCUMENTS_FILE",
});

function schemaFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? schemaFiles(path)
        : entry.name.endsWith(".schema.json")
          ? [path]
          : [];
    })
    .sort();
}

const require = createRequire(import.meta.url);
const bundledSchemaRoot = join(import.meta.dir, "ocf-schema");
const schemaRoot = existsSync(bundledSchemaRoot)
  ? bundledSchemaRoot
  : join(dirname(require.resolve("open-cap-format-ocf/package.json")), "schema");
const officialSchemas = schemaFiles(schemaRoot).map(
  (path) => JSON.parse(readFileSync(path, "utf8")) as object,
);

export const officialOcfSchemaCount = officialSchemas.length;

const ajv = new Ajv({ schemas: officialSchemas, allErrors: true, strict: false });
addFormats(ajv);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectIdAtPath(value: unknown, instancePath: string): string | undefined {
  const itemMatch = instancePath.match(/^\/items\/(\d+)/);
  if (!itemMatch || !isRecord(value)) return undefined;
  const items = value.items;
  if (!Array.isArray(items)) return undefined;
  const item = items[Number(itemMatch[1])];
  return isRecord(item) && typeof item.id === "string" ? item.id : undefined;
}

function schemaIssues(
  errors: readonly ErrorObject[] | null | undefined,
  file: string,
  value: unknown,
): OcfIssue[] {
  return (errors ?? []).map((error) => ({
    code: "OCF_SCHEMA_INVALID",
    severity: "ERROR",
    file,
    objectId: objectIdAtPath(value, error.instancePath),
    path: error.instancePath || "/",
    message: `${error.keyword}: ${error.message ?? "schema validation failed"}`,
  }));
}

function validator(schemaId: string): ValidateFunction {
  const validate = ajv.getSchema(schemaId);
  if (!validate) throw new Error(`Official OCF schema was not loaded: ${schemaId}`);
  return validate;
}

function manifestCategoryIssues(pkg: OcfPackage): readonly OcfIssue[] {
  if (!isRecord(pkg.manifest)) return [];
  const issues: OcfIssue[] = [];
  for (const [property, expectedFileType] of Object.entries(MANIFEST_FILE_TYPES)) {
    const references = pkg.manifest[property];
    if (!Array.isArray(references)) continue;
    for (const [index, reference] of references.entries()) {
      const filepath = isRecord(reference) ? reference.filepath : undefined;
      if (typeof filepath !== "string") continue;
      const file = pkg.files[filepath];
      if (!isRecord(file) || file.file_type === expectedFileType) continue;
      issues.push({
        code: "OCF_MANIFEST_FILE_TYPE_MISMATCH",
        severity: "ERROR",
        file: "manifest",
        path: `/${property}/${index}/filepath`,
        message: `${property} must reference ${expectedFileType}, not ${String(file.file_type)}.`,
      });
    }
  }
  return issues;
}

export function validateOcfPackageSchemas(pkg: OcfPackage): readonly OcfIssue[] {
  const issues: OcfIssue[] = [...manifestCategoryIssues(pkg)];
  const manifestValidator = validator(FILE_SCHEMA_IDS.OCF_MANIFEST_FILE as string);
  if (!manifestValidator(pkg.manifest)) {
    issues.push(...schemaIssues(manifestValidator.errors, "manifest", pkg.manifest));
  }

  for (const [filepath, file] of Object.entries(pkg.files).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!isRecord(file) || typeof file.file_type !== "string") {
      issues.push({
        code: "OCF_FILE_TYPE_MISSING",
        severity: "ERROR",
        file: filepath,
        path: "/file_type",
        message: "Referenced OCF files must declare a file_type.",
      });
      continue;
    }
    const schemaId = FILE_SCHEMA_IDS[file.file_type];
    if (!schemaId) {
      issues.push({
        code: "OCF_FILE_TYPE_UNSUPPORTED",
        severity: "ERROR",
        file: filepath,
        path: "/file_type",
        message: `Unknown OCF file_type: ${file.file_type}`,
      });
      continue;
    }
    const fileValidator = validator(schemaId);
    if (!fileValidator(file)) issues.push(...schemaIssues(fileValidator.errors, filepath, file));
  }
  return issues;
}

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}
