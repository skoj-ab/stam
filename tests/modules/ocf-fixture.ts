import type { OcfExportSource } from "../../src/modules/ocf/index.ts";

const issuanceMetadata = Object.freeze({
  sharePrice: { amount: "10", currency: "SEK" },
  securityLawExemptions: [],
  stockLegendIds: [],
});

const exportSourceFixture = {
  issuer: {
    id: "issuer-se",
    legalName: "Exempelbolaget AB",
    formationDate: "2019-01-01",
    organizationNumber: "556016-0680",
  },
  asOf: "2024-12-31",
  stakeholders: [
    {
      id: "seller",
      stakeholderType: "INDIVIDUAL",
      legalName: "Anna Andersson",
      taxId: "850709-9805",
      address: { streetSuite: "Testgatan 1", city: "Stockholm", postalCode: "111 11" },
    },
    {
      id: "buyer",
      stakeholderType: "INSTITUTION",
      legalName: "Köpare AB",
      taxId: "556677-8899",
      address: { streetSuite: "Köparvägen 2", city: "Göteborg", postalCode: "411 11" },
    },
  ],
  stockClasses: [
    {
      id: "class-a",
      name: "A",
      classType: "COMMON",
      defaultIdPrefix: "A-",
      initialSharesAuthorized: "1000",
      votesPerShare: "1",
      seniority: "1",
    },
  ],
  transactions: [
    {
      type: "STOCK_ISSUANCE",
      id: "issue-root",
      securityId: "security-root",
      date: "2020-01-01",
      stakeholderId: "seller",
      customId: "A-1",
      stockClassId: "class-a",
      quantity: "10",
      shareNumbers: [{ from: "1", to: "10" }],
      ...issuanceMetadata,
    },
    {
      type: "STOCK_ISSUANCE",
      id: "issue-buyer",
      securityId: "security-buyer",
      date: "2021-01-01",
      stakeholderId: "buyer",
      customId: "A-2",
      stockClassId: "class-a",
      quantity: "6",
      shareNumbers: [{ from: "1", to: "6" }],
      ...issuanceMetadata,
    },
    {
      type: "STOCK_ISSUANCE",
      id: "issue-seller-balance",
      securityId: "security-seller-balance",
      date: "2021-01-01",
      stakeholderId: "seller",
      customId: "A-3",
      stockClassId: "class-a",
      quantity: "4",
      shareNumbers: [{ from: "7", to: "10" }],
      ...issuanceMetadata,
    },
    {
      type: "STOCK_TRANSFER",
      id: "transfer-1",
      securityId: "security-root",
      date: "2021-01-01",
      quantity: "6",
      resultingSecurityIds: ["security-buyer"],
      balanceSecurityId: "security-seller-balance",
      considerationText: "Documented private sale",
      transferReason: { reason: "SALE" },
    },
    {
      type: "STOCK_ISSUANCE",
      id: "issue-cancellation-balance",
      securityId: "security-cancellation-balance",
      date: "2022-01-01",
      stakeholderId: "seller",
      customId: "A-4",
      stockClassId: "class-a",
      quantity: "2",
      shareNumbers: [{ from: "9", to: "10" }],
      ...issuanceMetadata,
    },
    {
      type: "STOCK_CANCELLATION",
      id: "cancel-1",
      securityId: "security-seller-balance",
      date: "2022-01-01",
      quantity: "2",
      reasonText: "Bolagsstämmans beslut",
      balanceSecurityId: "security-cancellation-balance",
    },
  ],
  preservedLosses: [
    {
      code: "UPSTREAM_NOTE_RETAINED",
      file: "source",
      path: "/note",
      message: "An upstream note remains outside OCF.",
    },
  ],
} satisfies OcfExportSource;

export function ocfExportSource(): OcfExportSource {
  return structuredClone(exportSourceFixture);
}
