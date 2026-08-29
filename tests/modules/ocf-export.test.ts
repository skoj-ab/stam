import { describe, expect, test } from "bun:test";
import {
  exportOcfPackage,
  type OcfExportSource,
  validateOcfPackageSchemas,
} from "../../src/modules/ocf/index.ts";
import { ocfExportSource } from "./ocf-fixture.ts";

describe("OCF v1.2.0 export", () => {
  test("generates an officially valid package and preserves all declared losses", () => {
    const fixture = ocfExportSource();
    const source: OcfExportSource = {
      ...fixture,
      issuer: { ...fixture.issuer, organizationNumber: "5500000004" },
      stakeholders: fixture.stakeholders.map((stakeholder, index) =>
        index === 0 ? { ...stakeholder, taxId: "8507092388" } : stakeholder,
      ),
    };
    const result = exportOcfPackage(source, {
      generatedAt: "2024-12-31T12:00:00Z",
    });

    expect(result.report.valid).toBe(true);
    if (!result.package) throw new Error(JSON.stringify(result.report.issues));
    expect(validateOcfPackageSchemas(result.package)).toEqual([]);
    expect(result.report.losses.map((loss) => loss.code)).toContain("UPSTREAM_NOTE_RETAINED");
    expect(result.report.losses.map((loss) => loss.code)).toContain(
      "STAM_TRANSFER_REASON_NOT_IN_OCF",
    );
    expect(Object.keys(result.package?.files ?? {})).toEqual([
      "./Stakeholders.ocf.json",
      "./StockClasses.ocf.json",
      "./Transactions.ocf.json",
    ]);
    const manifest = result.package.manifest as {
      issuer: { tax_ids: Array<{ tax_id: string }> };
    };
    const stakeholderFile = result.package.files["./Stakeholders.ocf.json"] as {
      items: Array<{ tax_ids: Array<{ tax_id: string }> }>;
    };
    expect(manifest.issuer.tax_ids[0]?.tax_id).toBe("550000-0004");
    expect(stakeholderFile.items[0]?.tax_ids[0]?.tax_id).toBe("850709-2388");
  });

  test("rejects missing mandatory OCF metadata instead of inventing it", () => {
    const source = structuredClone(ocfExportSource()) as OcfExportSource;
    const issuance = source.transactions.find(
      (transaction) => transaction.type === "STOCK_ISSUANCE",
    );
    if (!issuance) throw new Error("Fixture has no issuance.");
    const invalidSource = {
      ...source,
      transactions: source.transactions.map((transaction) =>
        transaction.id === issuance.id ? { ...transaction, customId: undefined } : transaction,
      ),
    } as unknown as OcfExportSource;

    const result = exportOcfPackage(invalidSource, { generatedAt: "2024-12-31T12:00:00Z" });
    expect(result.package).toBeUndefined();
    expect(result.report.valid).toBe(false);
    expect(result.report.issues.map((issue) => issue.code)).toContain("OCF_SCHEMA_INVALID");
  });
});
