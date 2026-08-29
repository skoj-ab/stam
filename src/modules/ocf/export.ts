import { createHash } from "node:crypto";
import { formatSwedishIdentifier } from "../../domain/swedish-identifiers.ts";
import { dryRunOcfImport } from "./import.ts";
import {
  type JsonValue,
  OCF_VERSION,
  type OcfDryRunReport,
  type OcfExportOptions,
  type OcfExportResult,
  type OcfExportSource,
  type OcfInformationLoss,
  type OcfPackage,
  type OcfTransferReasonResolution,
} from "./types.ts";

const defaultFilepaths = Object.freeze({
  stakeholders: "./Stakeholders.ocf.json",
  stockClasses: "./StockClasses.ocf.json",
  transactions: "./Transactions.ocf.json",
});

type ExportFilepaths = Readonly<{
  stakeholders: string;
  stockClasses: string;
  transactions: string;
}>;

function canonicalJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function md5(value: JsonValue): string {
  return createHash("md5").update(canonicalJson(value)).digest("hex");
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function buildFiles(
  source: OcfExportSource,
  filepaths: ExportFilepaths,
): Readonly<Record<string, JsonValue>> {
  const stakeholders = jsonValue({
    file_type: "OCF_STAKEHOLDERS_FILE",
    items: source.stakeholders.map((stakeholder) => ({
      object_type: "STAKEHOLDER",
      id: stakeholder.id,
      name: { legal_name: stakeholder.legalName },
      stakeholder_type: stakeholder.stakeholderType,
      addresses: [
        {
          address_type: "LEGAL",
          street_suite: stakeholder.address.streetSuite,
          city: stakeholder.address.city,
          country: "SE",
          postal_code: stakeholder.address.postalCode,
        },
      ],
      tax_ids: [{ tax_id: formatSwedishIdentifier(stakeholder.taxId), country: "SE" }],
    })),
  });
  const stockClasses = jsonValue({
    file_type: "OCF_STOCK_CLASSES_FILE",
    items: source.stockClasses.map((stockClass) => ({
      object_type: "STOCK_CLASS",
      id: stockClass.id,
      name: stockClass.name,
      class_type: stockClass.classType,
      default_id_prefix: stockClass.defaultIdPrefix,
      initial_shares_authorized: stockClass.initialSharesAuthorized,
      votes_per_share: stockClass.votesPerShare,
      seniority: stockClass.seniority,
    })),
  });
  const transactions = jsonValue({
    file_type: "OCF_TRANSACTIONS_FILE",
    items: source.transactions.map((transaction) => {
      if (transaction.type === "STOCK_ISSUANCE") {
        return {
          object_type: "TX_STOCK_ISSUANCE",
          id: transaction.id,
          security_id: transaction.securityId,
          date: transaction.date,
          security_law_exemptions: transaction.securityLawExemptions,
          stakeholder_id: transaction.stakeholderId,
          custom_id: transaction.customId,
          stock_class_id: transaction.stockClassId,
          share_price: transaction.sharePrice,
          quantity: transaction.quantity,
          share_numbers_issued: transaction.shareNumbers.map((range) => ({
            starting_share_number: range.from,
            ending_share_number: range.to,
          })),
          stock_legend_ids: transaction.stockLegendIds,
        };
      }
      if (transaction.type === "STOCK_TRANSFER") {
        return {
          object_type: "TX_STOCK_TRANSFER",
          id: transaction.id,
          security_id: transaction.securityId,
          date: transaction.date,
          quantity: transaction.quantity,
          resulting_security_ids: transaction.resultingSecurityIds,
          ...(transaction.balanceSecurityId
            ? { balance_security_id: transaction.balanceSecurityId }
            : {}),
          ...(transaction.considerationText
            ? { consideration_text: transaction.considerationText }
            : {}),
        };
      }
      return {
        object_type: "TX_STOCK_CANCELLATION",
        id: transaction.id,
        security_id: transaction.securityId,
        date: transaction.date,
        quantity: transaction.quantity,
        reason_text: transaction.reasonText,
        ...(transaction.balanceSecurityId
          ? { balance_security_id: transaction.balanceSecurityId }
          : {}),
      };
    }),
  });
  return Object.freeze({
    [filepaths.stakeholders]: stakeholders,
    [filepaths.stockClasses]: stockClasses,
    [filepaths.transactions]: transactions,
  });
}

function buildPackage(source: OcfExportSource, options: OcfExportOptions): OcfPackage {
  const filepaths = options.filepaths ?? defaultFilepaths;
  const files = buildFiles(source, filepaths);
  const manifest = jsonValue({
    ocf_version: OCF_VERSION,
    file_type: "OCF_MANIFEST_FILE",
    issuer: {
      object_type: "ISSUER",
      id: source.issuer.id,
      legal_name: source.issuer.legalName,
      formation_date: source.issuer.formationDate,
      country_of_formation: "SE",
      tax_ids: [
        { tax_id: formatSwedishIdentifier(source.issuer.organizationNumber), country: "SE" },
      ],
    },
    as_of: source.asOf,
    generated_at: options.generatedAt,
    stock_plans_files: [],
    stock_legend_templates_files: [],
    stock_classes_files: [
      { filepath: filepaths.stockClasses, md5: md5(files[filepaths.stockClasses] as JsonValue) },
    ],
    vesting_terms_files: [],
    valuations_files: [],
    transactions_files: [
      { filepath: filepaths.transactions, md5: md5(files[filepaths.transactions] as JsonValue) },
    ],
    stakeholders_files: [
      { filepath: filepaths.stakeholders, md5: md5(files[filepaths.stakeholders] as JsonValue) },
    ],
  });
  return Object.freeze({ manifest, files });
}

function exportLosses(source: OcfExportSource): readonly OcfInformationLoss[] {
  const losses: OcfInformationLoss[] = [...(source.preservedLosses ?? [])];
  for (const transaction of source.transactions) {
    if (transaction.type === "STOCK_TRANSFER") {
      losses.push({
        code: "STAM_TRANSFER_REASON_NOT_IN_OCF",
        file: "export-source",
        objectId: transaction.id,
        path: `/transactions/${transaction.id}/transferReason`,
        message:
          "OCF v1.2.0 has no structured field for Stam's transfer reason; the explicit value is retained in this report.",
      });
    }
  }
  return losses.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

function transferResolutions(
  source: OcfExportSource,
): Readonly<Record<string, OcfTransferReasonResolution>> {
  return Object.fromEntries(
    source.transactions.flatMap((transaction) =>
      transaction.type === "STOCK_TRANSFER" ? [[transaction.id, transaction.transferReason]] : [],
    ),
  );
}

function withExportLosses(report: OcfDryRunReport, source: OcfExportSource): OcfDryRunReport {
  return { ...report, losses: Object.freeze([...report.losses, ...exportLosses(source)]) };
}

export function exportOcfPackage(
  source: OcfExportSource,
  options: OcfExportOptions,
): OcfExportResult {
  const pkg = buildPackage(source, options);
  const validation = dryRunOcfImport(pkg, {
    mode: "TRANSACTION_HISTORY",
    transferReasonResolutions: transferResolutions(source),
  });
  const report = withExportLosses(validation.report, source);
  return report.valid ? { package: pkg, report } : { report };
}
