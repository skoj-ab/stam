export const OCF_VERSION = "1.2.0" as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type OcfPackage = Readonly<{
  manifest: JsonValue;
  files: Readonly<Record<string, JsonValue>>;
}>;

export type OcfImportMode = "OPENING_SNAPSHOT" | "TRANSACTION_HISTORY";
export type OcfIssueSeverity = "ERROR" | "WARNING";

export type OcfIssue = Readonly<{
  code: string;
  severity: OcfIssueSeverity;
  file: string;
  objectId?: string;
  path: string;
  message: string;
}>;

export type OcfInformationLoss = Readonly<{
  code: string;
  file: string;
  objectId?: string;
  path: string;
  message: string;
}>;

export type TransferReason = "SALE" | "GIFT" | "INHERITANCE" | "DIVISION_OF_PROPERTY" | "OTHER";

export type OcfTransferReasonResolution = Readonly<{
  reason: TransferReason;
  reasonNote?: string;
}>;

export type OcfImportOptions = Readonly<{
  mode: OcfImportMode;
  transferReasonResolutions?: Readonly<Record<string, OcfTransferReasonResolution>>;
}>;

export type OcfRequiredResolution = Readonly<{
  code: "TRANSFER_REASON_REQUIRED";
  sourceTransactionId: string;
  allowedValues: readonly TransferReason[];
  message: string;
}>;

export type OcfSupportedCounts = Readonly<{
  issuers: number;
  stakeholders: number;
  stockClasses: number;
  rootStockIssuances: number;
  linkedStockIssuances: number;
  stockTransfers: number;
  stockCancellations: number;
  openingHoldings: number;
  eventDrafts: number;
}>;

export type OcfCatalogInput =
  | Readonly<{
      kind: "COMPANY";
      sourceKey: string;
      input: Readonly<{
        legalName: string;
        registrationCountry: "SE";
        registrationScheme: "ORGANISATIONSNUMMER";
        registrationValue: string;
      }>;
    }>
  | Readonly<{
      kind: "SHAREHOLDER";
      sourceKey: string;
      input: Readonly<{
        companyId: string;
        kind: "INDIVIDUAL" | "LEGAL_ENTITY";
        identifierCountryCode: "SE";
        identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
        identifierValue: string;
        initialDetails: Readonly<{
          legalName: string;
          address: Readonly<{
            lines: readonly string[];
            postalCode: string;
            locality: string;
            countryCode: "SE";
          }>;
        }>;
        effectiveFrom: string;
      }>;
    }>
  | Readonly<{
      kind: "SHARE_CLASS";
      sourceKey: string;
      input: Readonly<{
        companyId: string;
        name: string;
        votesPerShare: string;
        effectiveFrom: string;
      }>;
    }>;

export type OcfEventDraft = Readonly<{
  sourceKey: string;
  effectiveDate: string;
  type: "OPENING_STATE_IMPORTED" | "SHARES_ISSUED" | "SHARES_TRANSFERRED" | "SHARES_CANCELLED";
  payload: Readonly<Record<string, unknown>>;
}>;

export type OcfConversion = Readonly<{
  mode: OcfImportMode;
  companySourceKey: string;
  catalogInputs: readonly OcfCatalogInput[];
  eventDrafts: readonly OcfEventDraft[];
}>;

export type OcfProposedCommand = Readonly<{
  sequence: number;
  sourceKey: string;
  command: "CREATE_COMPANY" | "CREATE_SHAREHOLDER" | "CREATE_SHARE_CLASS" | "APPEND_SHARE_EVENT";
  input: Readonly<Record<string, unknown>>;
}>;

export type OcfDryRunReport = Readonly<{
  ocfVersion: typeof OCF_VERSION;
  mode: OcfImportMode;
  valid: boolean;
  issues: readonly OcfIssue[];
  supportedCounts: OcfSupportedCounts;
  losses: readonly OcfInformationLoss[];
  requiredResolutions: readonly OcfRequiredResolution[];
  proposedCommands: readonly OcfProposedCommand[];
}>;

export type OcfDryRunResult = Readonly<{
  report: OcfDryRunReport;
  conversion?: OcfConversion;
}>;

export type OcfExportStakeholder = Readonly<{
  id: string;
  stakeholderType: "INDIVIDUAL" | "INSTITUTION";
  legalName: string;
  taxId: string;
  address: Readonly<{ streetSuite: string; city: string; postalCode: string }>;
}>;

export type OcfExportStockClass = Readonly<{
  id: string;
  name: string;
  classType: "COMMON" | "PREFERRED";
  defaultIdPrefix: string;
  initialSharesAuthorized: string;
  votesPerShare: string;
  seniority: string;
}>;

export type OcfExportTransaction =
  | Readonly<{
      type: "STOCK_ISSUANCE";
      id: string;
      securityId: string;
      date: string;
      stakeholderId: string;
      customId: string;
      stockClassId: string;
      quantity: string;
      shareNumbers: readonly Readonly<{ from: string; to: string }>[];
      sharePrice: Readonly<{ amount: string; currency: string }>;
      securityLawExemptions: readonly Readonly<{ description: string; jurisdiction: string }>[];
      stockLegendIds: readonly string[];
    }>
  | Readonly<{
      type: "STOCK_TRANSFER";
      id: string;
      securityId: string;
      date: string;
      quantity: string;
      resultingSecurityIds: readonly string[];
      balanceSecurityId?: string;
      considerationText?: string;
      transferReason: OcfTransferReasonResolution;
    }>
  | Readonly<{
      type: "STOCK_CANCELLATION";
      id: string;
      securityId: string;
      date: string;
      quantity: string;
      reasonText: string;
      balanceSecurityId?: string;
    }>;

export type OcfExportSource = Readonly<{
  issuer: Readonly<{
    id: string;
    legalName: string;
    formationDate: string;
    organizationNumber: string;
  }>;
  asOf: string;
  stakeholders: readonly OcfExportStakeholder[];
  stockClasses: readonly OcfExportStockClass[];
  transactions: readonly OcfExportTransaction[];
  preservedLosses?: readonly OcfInformationLoss[];
}>;

export type OcfExportOptions = Readonly<{
  generatedAt: string;
  filepaths?: Readonly<{
    stakeholders: string;
    stockClasses: string;
    transactions: string;
  }>;
}>;

export type OcfExportResult = Readonly<{
  package?: OcfPackage;
  report: OcfDryRunReport;
}>;
