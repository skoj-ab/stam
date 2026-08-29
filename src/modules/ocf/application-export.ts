import { createHash } from "node:crypto";
import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import {
  countRanges,
  createShareRegisterSnapshot,
  type ExactPrice,
  intersectRanges,
  rangesContain,
  type ShareRange,
  type ShareRegisterEvent,
  subtractRanges,
} from "../../domain/share-register/index.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { requireCompany } from "../companies/index.ts";
import { loadShareRegister } from "../share-register/index.ts";
import { exportOcfPackage } from "./export.ts";
import {
  OCF_VERSION,
  type OcfDryRunReport,
  type OcfExportResult,
  type OcfExportSource,
  type OcfExportTransaction,
  type OcfInformationLoss,
  type OcfIssue,
} from "./types.ts";

const effectiveDateSchema = z.iso.date();
const stockClassExportMetadataSchema = z
  .object({
    classType: z.enum(["COMMON", "PREFERRED"]),
    defaultIdPrefix: z.string().trim().min(1),
    initialSharesAuthorized: z.string().regex(/^[1-9]\d*(?:\.\d+)?$/),
    seniority: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  })
  .strict();

export const ocfCompanyExportOptionsSchema = z
  .object({
    formationDate: effectiveDateSchema,
    asOf: effectiveDateSchema,
    stockClasses: z.record(z.string().trim().min(1), stockClassExportMetadataSchema),
  })
  .strict();

export type OcfCompanyExportOptions = z.output<typeof ocfCompanyExportOptionsSchema>;

type Security = Readonly<{
  securityId: string;
  shareholderId: string;
  shareClassId: string;
  ranges: readonly ShareRange[];
  sharePrice: ExactPrice;
}>;

type ExportBuild = Readonly<{
  transactions: readonly OcfExportTransaction[];
  issues: readonly OcfIssue[];
  losses: readonly OcfInformationLoss[];
}>;

const emptyCounts = Object.freeze({
  issuers: 0,
  stakeholders: 0,
  stockClasses: 0,
  rootStockIssuances: 0,
  linkedStockIssuances: 0,
  stockTransfers: 0,
  stockCancellations: 0,
  openingHoldings: 0,
  eventDrafts: 0,
});

function adapterReport(issues: readonly OcfIssue[], losses: readonly OcfInformationLoss[]) {
  return Object.freeze({
    ocfVersion: OCF_VERSION,
    mode: "TRANSACTION_HISTORY" as const,
    valid: issues.length === 0,
    issues: Object.freeze([...issues]),
    supportedCounts: emptyCounts,
    losses: Object.freeze([...losses]),
    requiredResolutions: [],
    proposedCommands: [],
  });
}

function diagnostic(
  event: ShareRegisterEvent,
  code: string,
  message: string,
): Omit<OcfIssue, "severity"> {
  return {
    code,
    file: "stam-event-history",
    objectId: event.id,
    path: `/events/${event.sequence}`,
    message,
  };
}

function shareNumbers(ranges: readonly ShareRange[]) {
  return ranges.map(({ from, to }) => ({ from: String(from), to: String(to) }));
}

function issuanceTransaction(
  event: ShareRegisterEvent,
  security: Security,
  suffix: string,
): OcfExportTransaction {
  return {
    type: "STOCK_ISSUANCE",
    id: `stam-issuance-${event.id}-${suffix}`,
    securityId: security.securityId,
    date: event.effectiveDate,
    stakeholderId: security.shareholderId,
    customId: `STAM-${event.sequence}-${suffix}`,
    stockClassId: security.shareClassId,
    quantity: String(countRanges(security.ranges)),
    shareNumbers: shareNumbers(security.ranges),
    sharePrice: security.sharePrice,
    securityLawExemptions: [],
    stockLegendIds: [],
  };
}

function affectedSecurities(
  active: readonly Security[],
  shareholderId: string,
  shareClassId: string,
  ranges: readonly ShareRange[],
): readonly Readonly<{ security: Security; affected: readonly ShareRange[] }>[] {
  return active.flatMap((security) => {
    if (security.shareholderId !== shareholderId || security.shareClassId !== shareClassId)
      return [];
    const affected = intersectRanges(security.ranges, ranges);
    return affected.length > 0 ? [{ security, affected }] : [];
  });
}

function replacementSecurity(
  source: Security,
  securityId: string,
  shareholderId: string,
  ranges: readonly ShareRange[],
): Security {
  return { ...source, securityId, shareholderId, ranges };
}

function replaceActiveSecurity(
  active: Security[],
  source: Security,
  replacements: readonly Security[],
): void {
  const index = active.findIndex(({ securityId }) => securityId === source.securityId);
  if (index < 0) throw new Error(`Active OCF export security is missing: ${source.securityId}`);
  active.splice(index, 1, ...replacements);
}

function appendTransfer(
  event: Extract<ShareRegisterEvent, { type: "SHARES_TRANSFERRED" }>,
  active: Security[],
  transactions: OcfExportTransaction[],
  issues: OcfIssue[],
): void {
  const affected = affectedSecurities(
    active,
    event.payload.transferorId,
    event.payload.shareClassId,
    event.payload.ranges,
  );
  if (
    !rangesContain(
      affected.flatMap((entry) => entry.affected),
      event.payload.ranges,
    )
  ) {
    issues.push({
      ...diagnostic(
        event,
        "OCF_EXPORT_OWNERSHIP_GAP",
        "Transfer ranges cannot be tied to exported securities.",
      ),
      severity: "ERROR",
    });
    return;
  }
  for (const [index, entry] of affected.entries()) {
    const suffix = String(index + 1);
    const transferred = replacementSecurity(
      entry.security,
      `stam-security-${event.id}-transferred-${suffix}`,
      event.payload.transfereeId,
      entry.affected,
    );
    const balanceRanges = subtractRanges(entry.security.ranges, entry.affected);
    const balance =
      balanceRanges.length > 0
        ? replacementSecurity(
            entry.security,
            `stam-security-${event.id}-balance-${suffix}`,
            entry.security.shareholderId,
            balanceRanges,
          )
        : undefined;
    transactions.push(issuanceTransaction(event, transferred, `transferred-${suffix}`));
    if (balance) transactions.push(issuanceTransaction(event, balance, `balance-${suffix}`));
    transactions.push({
      type: "STOCK_TRANSFER",
      id: `stam-transfer-${event.id}-${suffix}`,
      securityId: entry.security.securityId,
      date: event.effectiveDate,
      quantity: String(countRanges(entry.affected)),
      resultingSecurityIds: [transferred.securityId],
      ...(balance ? { balanceSecurityId: balance.securityId } : {}),
      transferReason: {
        reason: event.payload.reason,
        ...(event.payload.reasonNote ? { reasonNote: event.payload.reasonNote } : {}),
      },
    });
    replaceActiveSecurity(active, entry.security, balance ? [transferred, balance] : [transferred]);
  }
}

function appendCancellation(
  event: Extract<ShareRegisterEvent, { type: "SHARES_CANCELLED" }>,
  active: Security[],
  transactions: OcfExportTransaction[],
  issues: OcfIssue[],
): void {
  const affected = affectedSecurities(
    active,
    event.payload.shareholderId,
    event.payload.shareClassId,
    event.payload.ranges,
  );
  if (
    !rangesContain(
      affected.flatMap((entry) => entry.affected),
      event.payload.ranges,
    )
  ) {
    issues.push({
      ...diagnostic(
        event,
        "OCF_EXPORT_OWNERSHIP_GAP",
        "Cancellation ranges cannot be tied to exported securities.",
      ),
      severity: "ERROR",
    });
    return;
  }
  for (const [index, entry] of affected.entries()) {
    const suffix = String(index + 1);
    const balanceRanges = subtractRanges(entry.security.ranges, entry.affected);
    const balance =
      balanceRanges.length > 0
        ? replacementSecurity(
            entry.security,
            `stam-security-${event.id}-balance-${suffix}`,
            entry.security.shareholderId,
            balanceRanges,
          )
        : undefined;
    if (balance) transactions.push(issuanceTransaction(event, balance, `balance-${suffix}`));
    transactions.push({
      type: "STOCK_CANCELLATION",
      id: `stam-cancellation-${event.id}-${suffix}`,
      securityId: entry.security.securityId,
      date: event.effectiveDate,
      quantity: String(countRanges(entry.affected)),
      reasonText: cancellationReasonText(event.payload),
      ...(balance ? { balanceSecurityId: balance.securityId } : {}),
    });
    replaceActiveSecurity(active, entry.security, balance ? [balance] : []);
  }
}

function cancellationReasonText(
  payload: Extract<ShareRegisterEvent, { type: "SHARES_CANCELLED" }>["payload"],
): string {
  if (payload.reason === "OTHER" && payload.reasonNote) return payload.reasonNote;
  return [payload.reason, payload.reasonNote].filter(Boolean).join(": ");
}

function buildTransactions(events: readonly ShareRegisterEvent[]): ExportBuild {
  const active: Security[] = [];
  const transactions: OcfExportTransaction[] = [];
  const issues: OcfIssue[] = [];
  const losses: OcfInformationLoss[] = [];
  for (const event of events) {
    if (event.type === "OPENING_STATE_IMPORTED") {
      if (event.payload.holdings.length > 0) {
        issues.push({
          ...diagnostic(
            event,
            "OCF_EXPORT_OPENING_PRICE_REQUIRED",
            "A populated opening state has no exact OCF issuance prices.",
          ),
          severity: "ERROR",
        });
      } else {
        losses.push(
          diagnostic(
            event,
            "STAM_OPENING_MARKER_NOT_IN_OCF",
            "The empty Stam opening marker has no OCF transaction equivalent.",
          ),
        );
      }
      continue;
    }
    if (event.type === "SHARES_ISSUED") {
      if (!event.payload.subscriptionPrice) {
        issues.push({
          ...diagnostic(
            event,
            "OCF_EXPORT_ISSUANCE_PRICE_REQUIRED",
            "OCF stock issuance requires an exact share price.",
          ),
          severity: "ERROR",
        });
        continue;
      }
      const security: Security = {
        securityId: `stam-security-${event.id}`,
        shareholderId: event.payload.shareholderId,
        shareClassId: event.payload.shareClassId,
        ranges: event.payload.ranges,
        sharePrice: event.payload.subscriptionPrice,
      };
      transactions.push(issuanceTransaction(event, security, "root"));
      active.push(security);
      continue;
    }
    if (event.type === "SHARES_TRANSFERRED") {
      appendTransfer(event, active, transactions, issues);
      continue;
    }
    if (event.type === "SHARES_CANCELLED") {
      appendCancellation(event, active, transactions, issues);
      continue;
    }
    if (
      event.type === "SHAREHOLDER_DETAILS_CHANGED" ||
      event.type === "SOURCE_ACTIVITY_RECORDED" ||
      event.type === "SHARE_CAPITAL_CHANGED"
    ) {
      losses.push(
        diagnostic(
          event,
          "STAM_EVENT_NOT_IN_OCF",
          `Stam event ${event.type} has no supported OCF v1.2.0 export mapping.`,
        ),
      );
      continue;
    }
    issues.push({
      ...diagnostic(
        event,
        "UNSUPPORTED_STAM_EVENT_FOR_OCF_EXPORT",
        `Stam event ${event.type} cannot be exported faithfully to the supported OCF profile.`,
      ),
      severity: "ERROR",
    });
  }
  return { transactions, issues, losses };
}

function mergeReport(
  report: OcfDryRunReport,
  adapterIssues: readonly OcfIssue[],
  adapterLosses: readonly OcfInformationLoss[],
): OcfDryRunReport {
  const issues = [...adapterIssues, ...report.issues];
  return {
    ...report,
    valid: report.valid && adapterIssues.length === 0,
    issues: Object.freeze(issues),
    losses: Object.freeze([...adapterLosses, ...report.losses]),
  };
}

function exportOptionIssues(
  shareClassIds: readonly string[],
  options: OcfCompanyExportOptions,
): readonly OcfIssue[] {
  const issues: OcfIssue[] = [];
  if (options.formationDate > options.asOf) {
    issues.push({
      code: "OCF_EXPORT_FORMATION_AFTER_AS_OF",
      severity: "ERROR",
      file: "export-options",
      path: "/formationDate",
      message: "Formation date must not be after the export as-of date.",
    });
  }
  for (const shareClassId of shareClassIds) {
    if (options.stockClasses[shareClassId]) continue;
    issues.push({
      code: "OCF_EXPORT_STOCK_CLASS_METADATA_REQUIRED",
      severity: "ERROR",
      file: "export-options",
      objectId: shareClassId,
      path: `/stockClasses/${shareClassId}`,
      message: "OCF class type, prefix, authorized shares, and seniority are required.",
    });
  }
  return issues;
}

function exportStakeholders(
  register: ReturnType<typeof loadShareRegister>,
  asOf: string,
): OcfExportSource["stakeholders"] {
  const snapshot = createShareRegisterSnapshot({ ...register, effectiveOn: asOf });
  const details = new Map(
    snapshot.shareholderDetails.map((entry) => [entry.shareholderId, entry.details]),
  );
  return register.shareholders
    .filter((shareholder) => shareholder.effectiveFrom <= asOf)
    .map((shareholder) => {
      const current = details.get(shareholder.id) ?? shareholder.initialDetails;
      return {
        id: shareholder.id,
        stakeholderType: shareholder.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "INSTITUTION",
        legalName: current.legalName,
        taxId: shareholder.identifierValue,
        address: {
          streetSuite: current.address.lines.join("\n"),
          city: current.address.locality,
          postalCode: current.address.postalCode,
        },
      };
    });
}

function exportStockClasses(
  register: ReturnType<typeof loadShareRegister>,
  options: OcfCompanyExportOptions,
): OcfExportSource["stockClasses"] {
  return register.shareClasses
    .filter((shareClass) => shareClass.effectiveFrom <= options.asOf)
    .map((shareClass) => ({
      id: shareClass.id,
      name: shareClass.name,
      votesPerShare: shareClass.votesPerShare,
      ...(options.stockClasses[shareClass.id] as z.output<typeof stockClassExportMetadataSchema>),
    }));
}

function createExportSource(
  database: DatabaseContext,
  companyId: string,
  options: OcfCompanyExportOptions,
): Readonly<{ source?: OcfExportSource; report: OcfDryRunReport }> {
  const company = requireCompany(database, companyId);
  const register = loadShareRegister(database, companyId);
  const events = register.events
    .filter((event) => event.effectiveDate <= options.asOf)
    .sort(
      (left, right) =>
        left.effectiveDate.localeCompare(right.effectiveDate) || left.sequence - right.sequence,
    );
  const built = buildTransactions(events);
  const activeShareClassIds = register.shareClasses
    .filter((shareClass) => shareClass.effectiveFrom <= options.asOf)
    .map((shareClass) => shareClass.id);
  const issues = [...built.issues, ...exportOptionIssues(activeShareClassIds, options)];
  if (issues.length > 0) return { report: adapterReport(issues, built.losses) };
  return {
    report: adapterReport([], built.losses),
    source: {
      issuer: {
        id: company.id,
        legalName: company.legalName,
        formationDate: options.formationDate,
        organizationNumber: company.registrationValue,
      },
      asOf: options.asOf,
      stakeholders: exportStakeholders(register, options.asOf),
      stockClasses: exportStockClasses(register, options),
      transactions: built.transactions,
      preservedLosses: built.losses,
    },
  };
}

export function exportCompanyOcfPackage(
  database: DatabaseContext,
  companyId: string,
  input: unknown,
  actorUserId: string,
): OcfExportResult {
  const options = ocfCompanyExportOptionsSchema.parse(input);
  const built = createExportSource(database, companyId, options);
  if (!built.source) return { report: built.report };
  const exported = exportOcfPackage(built.source, { generatedAt: new Date().toISOString() });
  const report = mergeReport(exported.report, built.report.issues, []);
  if (!exported.package || !report.valid) return { report };
  const serialized = JSON.stringify(exported.package);
  recordAuditEvent(database, {
    type: "EXPORT_GENERATED",
    outcome: "SUCCEEDED",
    actorKind: "USER",
    actorUserId,
    companyId,
    payload: {
      format: "OCF_1_2_0",
      asOf: options.asOf,
      sha256: createHash("sha256").update(serialized).digest("hex"),
      size: Buffer.byteLength(serialized),
      informationLossCount: report.losses.length,
    },
  });
  return { package: exported.package, report };
}
