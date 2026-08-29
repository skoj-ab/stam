import { describe, expect, test } from "bun:test";
import {
  convertOcfPackage,
  dryRunOcfImport,
  exportOcfPackage,
  type OcfPackage,
  officialOcfSchemaCount,
} from "../../src/modules/ocf/index.ts";
import { ocfExportSource } from "./ocf-fixture.ts";

function validPackage(): OcfPackage {
  const result = exportOcfPackage(ocfExportSource(), { generatedAt: "2024-12-31T12:00:00Z" });
  if (!result.package) throw new Error(JSON.stringify(result.report.issues));
  return result.package;
}

function mutablePackage(): Record<string, unknown> {
  return structuredClone(validPackage()) as unknown as Record<string, unknown>;
}

function transactionItems(pkg: Record<string, unknown>): Record<string, unknown>[] {
  const files = pkg.files as Record<string, Record<string, unknown>>;
  return files["./Transactions.ocf.json"]?.items as Record<string, unknown>[];
}

function fileItems(pkg: Record<string, unknown>, filepath: string): Record<string, unknown>[] {
  const files = pkg.files as Record<string, Record<string, unknown>>;
  return files[filepath]?.items as Record<string, unknown>[];
}

function requiredFirst<T>(items: readonly T[] | undefined): T {
  const first = items?.[0];
  if (!first) throw new Error("Expected a manifest file entry");
  return first;
}

const reasons = { "transfer-1": { reason: "SALE" as const } };

describe("OCF v1.2.0 import core", () => {
  test("loads all official package schemas and produces deterministic history commands", () => {
    const pkg = validPackage();
    const result = dryRunOcfImport(pkg, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    });

    expect(officialOcfSchemaCount).toBe(168);
    expect(result.report.valid).toBe(true);
    expect(result.report.supportedCounts).toMatchObject({
      rootStockIssuances: 1,
      linkedStockIssuances: 3,
      stockTransfers: 1,
      stockCancellations: 1,
      eventDrafts: 4,
    });
    expect(result.conversion?.eventDrafts.map((draft) => draft.type)).toEqual([
      "OPENING_STATE_IMPORTED",
      "SHARES_ISSUED",
      "SHARES_TRANSFERRED",
      "SHARES_CANCELLED",
    ]);
    expect(
      result.conversion?.eventDrafts.filter((draft) => draft.type === "SHARES_ISSUED"),
    ).toHaveLength(1);
    expect(result.conversion?.eventDrafts[2]?.payload).toMatchObject({
      ranges: [{ from: 1, to: 6 }],
      reason: "SALE",
    });
    expect(result.conversion?.eventDrafts[3]?.payload).toMatchObject({
      ranges: [{ from: 7, to: 8 }],
      reason: "OTHER",
    });
    expect(result.report.proposedCommands.map((command) => command.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(result.report.proposedCommands).toEqual(
      dryRunOcfImport(pkg, {
        mode: "TRANSACTION_HISTORY",
        transferReasonResolutions: reasons,
      }).report.proposedCommands,
    );
  });

  test("builds current active leaves in opening snapshot mode", () => {
    const result = dryRunOcfImport(validPackage(), {
      mode: "OPENING_SNAPSHOT",
      transferReasonResolutions: reasons,
    });

    expect(result.report.valid).toBe(true);
    expect(result.report.supportedCounts.openingHoldings).toBe(2);
    expect(
      result.report.losses.filter((loss) => loss.code === "OCF_HISTORY_COLLAPSED_TO_SNAPSHOT"),
    ).toHaveLength(6);
    expect(result.conversion?.eventDrafts).toHaveLength(1);
    expect(result.conversion?.eventDrafts[0]?.payload.holdings).toEqual([
      {
        shareholderId: "$shareholder:ocf:stakeholder:buyer",
        shareClassId: "$share-class:ocf:stock-class:class-a",
        ranges: [{ from: 1, to: 6 }],
      },
      {
        shareholderId: "$shareholder:ocf:stakeholder:seller",
        shareClassId: "$share-class:ocf:stock-class:class-a",
        ranges: [{ from: 9, to: 10 }],
      },
    ]);
  });

  test("requires an explicit transfer reason keyed by source transaction ID", () => {
    const result = dryRunOcfImport(validPackage(), { mode: "TRANSACTION_HISTORY" });

    expect(result.report.valid).toBe(false);
    expect(result.report.requiredResolutions).toEqual([
      expect.objectContaining({
        code: "TRANSFER_REASON_REQUIRED",
        sourceTransactionId: "transfer-1",
      }),
    ]);
    expect(result.report.issues.map((issue) => issue.code)).toContain("TRANSFER_REASON_REQUIRED");
    expect(() => convertOcfPackage(validPackage(), { mode: "TRANSACTION_HISTORY" })).toThrow(
      /TRANSFER_REASON_REQUIRED/,
    );
  });

  test("rejects malformed exact ranges, broken references, duplicate IDs, and unsupported securities", () => {
    const malformed = mutablePackage();
    const malformedItems = transactionItems(malformed);
    const root = malformedItems.find((item) => item.id === "issue-root");
    if (root)
      root.share_numbers_issued = [{ starting_share_number: "1.5", ending_share_number: "10" }];

    const broken = mutablePackage();
    const brokenTransfer = transactionItems(broken).find((item) => item.id === "transfer-1");
    if (brokenTransfer) brokenTransfer.security_id = "missing";

    const duplicate = mutablePackage();
    const duplicateItems = transactionItems(duplicate);
    if (duplicateItems[1]) duplicateItems[1].id = "issue-root";

    const unsupported = mutablePackage();
    transactionItems(unsupported).push({
      object_type: "TX_WARRANT_CANCELLATION",
      id: "warrant-cancel",
      security_id: "warrant-1",
      date: "2022-01-01",
      quantity: "1",
      reason_text: "Unsupported",
    });

    const codes = (pkg: Record<string, unknown>) =>
      dryRunOcfImport(pkg as unknown as OcfPackage, {
        mode: "TRANSACTION_HISTORY",
        transferReasonResolutions: reasons,
      }).report.issues.map((issue) => issue.code);

    expect(codes(malformed)).toContain("MALFORMED_SHARE_RANGE");
    expect(codes(broken)).toContain("BROKEN_SECURITY_REFERENCE");
    expect(codes(duplicate)).toContain("DUPLICATE_OBJECT_ID");
    expect(codes(unsupported)).toContain("UNSUPPORTED_OCF_OBJECT");
  });

  test("rejects lifecycle partitions that do not preserve exact source ranges", () => {
    const pkg = mutablePackage();
    const balance = transactionItems(pkg).find((item) => item.id === "issue-seller-balance");
    if (balance)
      balance.share_numbers_issued = [{ starting_share_number: "8", ending_share_number: "10" }];

    const result = dryRunOcfImport(pkg as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    });
    expect(result.report.valid).toBe(false);
    expect(result.report.issues.map((issue) => issue.code)).toContain(
      "TRANSFER_RANGE_PARTITION_MISMATCH",
    );
  });

  test("orders same-day terminal descendants by lineage rather than object ID", () => {
    const pkg = mutablePackage();
    const items = transactionItems(pkg);
    const cancellationBalance = items.find((item) => item.id === "issue-cancellation-balance");
    const cancellation = items.find((item) => item.id === "cancel-1");
    if (cancellationBalance) cancellationBalance.date = "2021-01-01";
    if (cancellation) cancellation.date = "2021-01-01";

    const conversion = convertOcfPackage(pkg as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    });
    expect(conversion.eventDrafts.map((draft) => draft.sourceKey)).toEqual([
      "ocf:bootstrap:issuer-se",
      "ocf:transaction:issue-root",
      "ocf:transaction:transfer-1",
      "ocf:transaction:cancel-1",
    ]);
  });

  test("rejects cyclic, backwards-dated, and stock-plan-backed stock lineage", () => {
    const pkg = mutablePackage();
    const items = transactionItems(pkg);
    const root = items.find((item) => item.id === "issue-root");
    const transfer = items.find((item) => item.id === "transfer-1");
    const cancellation = items.find((item) => item.id === "cancel-1");
    if (root) root.stock_plan_id = "unsupported-plan";
    if (transfer) transfer.date = "2018-01-01";
    if (cancellation) cancellation.balance_security_id = "security-root";

    const result = dryRunOcfImport(pkg as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    });
    const codes = result.report.issues.map((issue) => issue.code);
    expect(codes).toContain("UNSUPPORTED_STOCK_SECURITY_TERMS");
    expect(codes).toContain("TERMINAL_BEFORE_SECURITY_ISSUANCE");
    expect(codes).toContain("LIFECYCLE_CYCLE");
  });

  test("rejects values that are valid OCF but incompatible with Stam catalogs", () => {
    const pkg = mutablePackage();
    const stakeholders = fileItems(pkg, "./Stakeholders.ocf.json");
    stakeholders.push({ ...structuredClone(stakeholders[0]), id: "duplicate-owner" });
    const classes = fileItems(pkg, "./StockClasses.ocf.json");
    classes.push({ ...structuredClone(classes[0]), id: "duplicate-class" });
    if (classes[0]) classes[0].votes_per_share = "+1";
    if (classes[1]) classes[1].name = classes[0]?.name;

    const result = dryRunOcfImport(pkg as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    });
    const codes = result.report.issues.map((issue) => issue.code);
    expect(codes).toContain("DUPLICATE_STAM_SHAREHOLDER_IDENTIFIER");
    expect(codes).toContain("DUPLICATE_STAM_SHARE_CLASS_NAME");
    expect(codes).toContain("STAM_DECIMAL_INCOMPATIBLE");
    expect(result.report.valid).toBe(false);
  });

  test("enforces globally unique root ranges", () => {
    const overlapping = mutablePackage();
    fileItems(overlapping, "./StockClasses.ocf.json").push({
      object_type: "STOCK_CLASS",
      id: "class-b",
      name: "B",
      class_type: "COMMON",
      default_id_prefix: "B-",
      initial_shares_authorized: "100",
      votes_per_share: "1",
      seniority: "1",
    });
    transactionItems(overlapping).push({
      object_type: "TX_STOCK_ISSUANCE",
      id: "issue-overlap-class-b",
      security_id: "security-overlap-class-b",
      date: "2020-01-01",
      security_law_exemptions: [],
      stakeholder_id: "seller",
      custom_id: "B-1",
      stock_class_id: "class-b",
      share_price: { amount: "10", currency: "SEK" },
      quantity: "2",
      share_numbers_issued: [{ starting_share_number: "1", ending_share_number: "2" }],
      stock_legend_ids: [],
    });
    const overlapCodes = dryRunOcfImport(overlapping as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    }).report.issues.map((issue) => issue.code);
    expect(overlapCodes).toContain("ROOT_ISSUANCE_RANGES_OVERLAP");
  });

  test("enforces manifest file categories", () => {
    const mismatched = mutablePackage();
    const manifest = mismatched.manifest as Record<string, Array<{ filepath: string }>>;
    const transactionFile = requiredFirst(manifest.transactions_files);
    const stakeholderFile = requiredFirst(manifest.stakeholders_files);
    const transactionPath = transactionFile.filepath;
    transactionFile.filepath = stakeholderFile.filepath;
    stakeholderFile.filepath = transactionPath;
    const mismatchCodes = dryRunOcfImport(mismatched as unknown as OcfPackage, {
      mode: "TRANSACTION_HISTORY",
      transferReasonResolutions: reasons,
    }).report.issues.map((issue) => issue.code);
    expect(mismatchCodes).toContain("OCF_MANIFEST_FILE_TYPE_MISMATCH");
  });
});
