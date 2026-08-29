import { z } from "zod";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import type {
  ShareClass,
  Shareholder,
  ShareRegisterEvent,
  ShareRegisterSnapshot,
} from "../../domain/share-register/index.ts";
import { type Company, createCompany, requireCompany } from "../companies/index.ts";
import { createShareClass } from "../share-classes/index.ts";
import { appendShareEvents, shareEventDraftBatchSchema } from "../share-events/index.ts";
import { createShareholder } from "../shareholders/index.ts";
import { dryRunOcfImport } from "./import.ts";
import {
  type JsonValue,
  OCF_VERSION,
  type OcfConversion,
  type OcfDryRunReport,
  type OcfDryRunResult,
  type OcfImportOptions,
  type OcfPackage,
} from "./types.ts";

const transferReasonSchema = z
  .object({
    reason: z.enum(["SALE", "GIFT", "INHERITANCE", "DIVISION_OF_PROPERTY", "OTHER"]),
    reasonNote: z.string().trim().min(1).optional(),
  })
  .strict();

export const ocfPackageSchema = z
  .object({
    manifest: z.json(),
    files: z.record(z.string().trim().min(1), z.json()),
  })
  .strict();

export const ocfImportOptionsSchema = z
  .object({
    mode: z.enum(["OPENING_SNAPSHOT", "TRANSACTION_HISTORY"]),
    transferReasonResolutions: z.record(z.string().trim().min(1), transferReasonSchema).optional(),
  })
  .strict();

export const ocfImportRequestSchema = z
  .object({
    package: ocfPackageSchema,
    options: ocfImportOptionsSchema,
  })
  .strict();

export type OcfImportRequest = Readonly<{
  package: OcfPackage;
  options: OcfImportOptions;
}>;

export type OcfImportResult = Readonly<{
  report: OcfDryRunReport;
  company: Company;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  events: readonly ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
}>;

export class OcfImportError extends Error {
  readonly report: OcfDryRunReport;

  constructor(report: OcfDryRunReport) {
    super("OCF package cannot be imported");
    this.name = "OcfImportError";
    this.report = report;
  }
}

function parseRequest(input: unknown): OcfImportRequest {
  const parsed = ocfImportRequestSchema.parse(input);
  return parsed as OcfImportRequest;
}

export function previewOcfImport(input: unknown): OcfDryRunResult {
  const request = parseRequest(input);
  return dryRunOcfImport(request.package, request.options);
}

function placeholder(kind: "company" | "shareholder" | "share-class", sourceKey: string): string {
  return `$${kind}:${sourceKey}`;
}

function replacePlaceholders(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, ids));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, ids)]),
  );
}

function persistCatalog(
  database: DatabaseContext,
  conversion: OcfConversion,
  actorUserId: string,
): Readonly<{
  company: Company;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  ids: ReadonlyMap<string, string>;
}> {
  const companyInput = conversion.catalogInputs.find((input) => input.kind === "COMPANY");
  if (!companyInput) throw new Error("OCF conversion has no company command");
  const company = createCompany(database, companyInput.input, actorUserId);
  const ids = new Map<string, string>([
    [placeholder("company", companyInput.sourceKey), company.id],
  ]);
  const shareholders: Shareholder[] = [];
  const shareClasses: ShareClass[] = [];

  for (const catalogInput of conversion.catalogInputs) {
    if (catalogInput.kind === "SHAREHOLDER") {
      const shareholder = createShareholder(
        database,
        {
          ...catalogInput.input,
          companyId: company.id,
          initialDetails: {
            ...catalogInput.input.initialDetails,
            address: {
              ...catalogInput.input.initialDetails.address,
              lines: [...catalogInput.input.initialDetails.address.lines],
            },
          },
        },
        actorUserId,
      );
      shareholders.push(shareholder);
      ids.set(placeholder("shareholder", catalogInput.sourceKey), shareholder.id);
    }
    if (catalogInput.kind === "SHARE_CLASS") {
      const shareClass = createShareClass(
        database,
        { ...catalogInput.input, companyId: company.id },
        actorUserId,
      );
      shareClasses.push(shareClass);
      ids.set(placeholder("share-class", catalogInput.sourceKey), shareClass.id);
    }
  }
  return { company, shareholders, shareClasses, ids };
}

function persistOcfImport(
  database: DatabaseContext,
  request: OcfImportRequest,
  actorUserId: string,
): OcfImportResult {
  const analyzed = dryRunOcfImport(request.package, request.options);
  if (!analyzed.conversion) throw new OcfImportError(analyzed.report);
  const catalog = persistCatalog(database, analyzed.conversion, actorUserId);
  const drafts = shareEventDraftBatchSchema.parse(
    analyzed.conversion.eventDrafts.map(({ effectiveDate, type, payload }) => ({
      effectiveDate,
      type,
      payload: replacePlaceholders(payload, catalog.ids),
    })),
  );
  const appended = appendShareEvents(database, catalog.company.id, drafts, actorUserId, {
    kind: "OCF_V1_2_0",
    details: {
      mode: request.options.mode,
      ocfVersion: OCF_VERSION,
      sourceObjectCount:
        analyzed.report.supportedCounts.stakeholders +
        analyzed.report.supportedCounts.stockClasses +
        analyzed.report.supportedCounts.rootStockIssuances +
        analyzed.report.supportedCounts.linkedStockIssuances +
        analyzed.report.supportedCounts.stockTransfers +
        analyzed.report.supportedCounts.stockCancellations,
      informationLossCount: analyzed.report.losses.length,
    },
  });
  return Object.freeze({
    report: analyzed.report,
    company: requireCompany(database, catalog.company.id),
    shareholders: Object.freeze(catalog.shareholders),
    shareClasses: Object.freeze(catalog.shareClasses),
    events: appended.events,
    currentSnapshot: appended.currentSnapshot,
  });
}

export function commitOcfImport(
  database: DatabaseContext,
  input: unknown,
  actorUserId: string,
): OcfImportResult {
  const request = parseRequest(input);
  return withImmediateTransaction(database.sqlite, () =>
    persistOcfImport(database, request, z.string().trim().min(1).parse(actorUserId)),
  );
}

export function asOcfPackage(value: unknown): OcfPackage {
  return ocfPackageSchema.parse(value) as Readonly<{
    manifest: JsonValue;
    files: Readonly<Record<string, JsonValue>>;
  }>;
}
