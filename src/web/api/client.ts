import type {
  ShareClass,
  Shareholder,
  ShareRegisterEvent,
  ShareRegisterSnapshot,
} from "../../domain/share-register/types";
import type {
  OcfDryRunReport,
  OcfDryRunResult,
  OcfImportOptions,
  OcfPackage,
} from "../../modules/ocf/types";

export type Company = {
  id: string;
  legalName: string;
  registrationCountry: string;
  registrationScheme: string;
  registrationValue: string;
  status: "DRAFT" | "ACTIVE";
  createdAt: string;
  createdBy: string;
};

export type SessionData = {
  session: { id: string; expiresAt: string };
  user: { id: string; name: string; email: string; role?: string | null };
};

export type SetupStatus = { required: boolean };

export type InitialAdmin = {
  user: { id: string; name: string; email: string; role?: string | null };
};

export type AdminDirectory = {
  asOf: string;
  users: Array<{
    id: string;
    name: string;
    email: string;
    roles: string[];
    accessStatus: "ACTIVE" | "BANNED";
    createdAt: string;
    removable: boolean;
  }>;
  invitations: Array<{
    id: string;
    userId: string;
    email: string;
    name: string;
    roles: string[];
    status: "PENDING" | "CONSUMED" | "EXPIRED";
    createdAt: string;
    expiresAt: string;
    consumedAt: string | null;
    createdBy: string;
    createdByName: string;
  }>;
};

export type CreatedAdminInvitation = {
  invitation: {
    id: string;
    userId: string;
    email: string;
    name: string;
    expiresAt: string;
    createdAt: string;
    createdBy: string;
    consumedAt: string | null;
  };
  token: string;
  acceptanceUrl: string;
};

export type ShareEventDraft = {
  effectiveDate: string;
  type: ShareRegisterEvent["type"];
  payload: Record<string, unknown>;
};

export type EventMutationResult = {
  events: ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
};

export type ShareholderCopyCandidate = {
  sourceCompany: Pick<Company, "id" | "legalName" | "registrationValue">;
  sourceShareholderId: string;
  kind: Shareholder["kind"];
  identifierCountryCode: Shareholder["identifierCountryCode"];
  identifierScheme: Shareholder["identifierScheme"];
  identifierValue: string;
  details: Shareholder["initialDetails"];
};

export type ShareholderCompanyMatch = {
  company: Pick<Company, "id" | "legalName" | "registrationValue">;
  shareholderId: string;
  details: Shareholder["initialDetails"];
};

export type MultiCompanyDetailsChangeInput = {
  targetCompanyIds: string[];
  effectiveDate: string;
  after: Shareholder["initialDetails"];
};

export type MultiCompanyDetailsChangeResult = {
  results: Array<{
    company: ShareholderCompanyMatch["company"];
    shareholderId: string;
    events: ShareRegisterEvent[];
  }>;
};

export type FortnoxImportInput = {
  detailedRegisterText: string;
  ownerOverviewText: string;
  eventsHtml: string;
};

export type FortnoxImportFiles = {
  detailedRegisterPdf: File;
  ownerOverviewPdf: File;
  eventsHtml: File;
};

export type FortnoxImportWarning = {
  code: "UNSUPPORTED_EVENT_TYPE" | "SOURCE_HISTORY_ORDER";
  message: string;
  sourceId?: string;
  postNumber?: number;
};

export type FortnoxImportPlan = {
  company: {
    legalName: string;
    registrationCountry: "SE";
    registrationScheme: "ORGANISATIONSNUMMER";
    registrationValue: string;
    exportDate: string;
  };
  shareClass: {
    name: string;
    votesPerShare: string;
    totalShares: number;
    totalVotes: string;
  };
  shareCapital: { amount: string; currency: "SEK" };
  shareholders: Array<{
    key: string;
    kind: "INDIVIDUAL" | "LEGAL_ENTITY";
    identifierCountryCode: "SE";
    identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
    identifierValue: string;
    initialDetails: Shareholder["initialDetails"];
    effectiveFrom: string;
    totalShares: number;
    totalVotes: string;
  }>;
  holdings: Array<{
    shareholderKey: string;
    ranges: Array<{ from: number; to: number }>;
  }>;
  sourceEvents: Array<{
    sourceId: string;
    date: string;
    type: string;
    description: string;
    handling: "RECORDED_AS_SOURCE";
  }>;
  analysis: {
    totalShares: number;
    totalVotes: string;
    shareClass: string;
    checks: {
      rangeCounts: true;
      nonOverlappingRanges: true;
      contiguousRanges: true;
      votes: true;
      overviewTotals: true;
      overviewOwners: true;
      oneShareClass: true;
    };
    warnings: FortnoxImportWarning[];
  };
};

export type FortnoxImportPreview = {
  plan: FortnoxImportPlan;
  currentSnapshot: ShareRegisterSnapshot;
};

export type FortnoxImportResult = {
  plan: FortnoxImportPlan;
  company: Company;
  shareholders: Shareholder[];
  shareClasses: ShareClass[];
  events: ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
};

export type OcfImportRequest = {
  package: OcfPackage;
  options: OcfImportOptions;
};

export type OcfImportResult = {
  report: OcfDryRunReport;
  company: Company;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  events: readonly ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
};

export type OcfStockClassExportMetadata = {
  classType: "COMMON" | "PREFERRED";
  defaultIdPrefix: string;
  initialSharesAuthorized: string;
  seniority: string;
};

export type OcfCompanyExportOptions = {
  formationDate: string;
  asOf: string;
  stockClasses: Record<string, OcfStockClassExportMetadata>;
};

export type OcfExportResult = {
  package?: OcfPackage;
  report: OcfDryRunReport;
};

type ApiErrorBody = {
  error?: string;
  code?: string;
  issues?: Array<{ path?: Array<PropertyKey>; message?: string }>;
  report?: OcfDryRunReport;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly issues: NonNullable<ApiErrorBody["issues"]>;
  readonly report?: OcfDryRunReport;

  constructor({ status, body }: { status: number; body: ApiErrorBody }) {
    super(body.issues?.[0]?.message || body.error || `Begäran misslyckades (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.issues = body.issues ?? [];
    this.report = body.report;
  }
}

export async function requestJson<T>({
  path,
  init = {},
}: {
  path: string;
  init?: RequestInit;
}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const body = (await response.json().catch(() => ({}))) as T | ApiErrorBody;
  if (!response.ok) throw new ApiError({ status: response.status, body: body as ApiErrorBody });
  return body as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ett oväntat fel inträffade.";
}

export function getSession(): Promise<SessionData> {
  return requestJson({ path: "/api/session" });
}

export function getSetupStatus(): Promise<SetupStatus> {
  return requestJson({ path: "/api/setup/status" });
}

export function createInitialAdmin(input: {
  email: string;
  name: string;
  password: string;
}): Promise<InitialAdmin> {
  return requestJson({
    path: "/api/setup",
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export function getAdminDirectory(): Promise<AdminDirectory> {
  return requestJson({ path: "/api/admin/directory" });
}

export function createAdminInvitation(input: {
  email: string;
  name: string;
  expiresAt?: string;
}): Promise<CreatedAdminInvitation> {
  return requestJson({
    path: "/api/admin/invitations",
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export function removeAdminUser(userId: string): Promise<void> {
  return requestJson({
    path: `/api/admin/users/${encodeURIComponent(userId)}`,
    init: { method: "DELETE" },
  });
}

export function listCompanies(): Promise<Company[]> {
  return requestJson({ path: "/api/companies" });
}

function fortnoxImportFormData(files: FortnoxImportFiles): FormData {
  const form = new FormData();
  form.append("detailedRegisterPdf", files.detailedRegisterPdf);
  form.append("ownerOverviewPdf", files.ownerOverviewPdf);
  form.append("eventsHtml", files.eventsHtml);
  return form;
}

export function previewFortnoxImport(files: FortnoxImportFiles): Promise<FortnoxImportPreview> {
  return requestJson({
    path: "/api/companies/imports/fortnox/preview",
    init: { method: "POST", body: fortnoxImportFormData(files) },
  });
}

export function commitFortnoxImport(files: FortnoxImportFiles): Promise<FortnoxImportResult> {
  return requestJson({
    path: "/api/companies/imports/fortnox",
    init: { method: "POST", body: fortnoxImportFormData(files) },
  });
}

export function previewOcfImport(input: OcfImportRequest): Promise<OcfDryRunResult> {
  return requestJson({
    path: "/api/companies/imports/ocf/preview",
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export function commitOcfImport(input: OcfImportRequest): Promise<OcfImportResult> {
  return requestJson({
    path: "/api/companies/imports/ocf",
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

type CompanyRequest = { companyId: string };

export function getCompany({ companyId }: CompanyRequest): Promise<Company> {
  return requestJson({ path: `/api/companies/${companyId}` });
}

export function removeCompany({ companyId }: CompanyRequest): Promise<void> {
  return requestJson({ path: `/api/companies/${companyId}`, init: { method: "DELETE" } });
}

export function listShareholders({ companyId }: CompanyRequest): Promise<Shareholder[]> {
  return requestJson({ path: `/api/companies/${companyId}/shareholders` });
}

export function listShareholderCopyCandidates({
  companyId,
}: CompanyRequest): Promise<ShareholderCopyCandidate[]> {
  return requestJson({ path: `/api/companies/${companyId}/shareholder-copy-candidates` });
}

export function listShareholderCompanyMatches({
  companyId,
  shareholderId,
}: CompanyRequest & { shareholderId: string }): Promise<ShareholderCompanyMatch[]> {
  return requestJson({
    path: `/api/companies/${companyId}/shareholders/${shareholderId}/company-matches`,
  });
}

type MultiCompanyDetailsChangeRequest = CompanyRequest & {
  shareholderId: string;
  input: MultiCompanyDetailsChangeInput;
};

function mutateMultiCompanyDetails({
  companyId,
  shareholderId,
  input,
  preview,
}: MultiCompanyDetailsChangeRequest & {
  preview: boolean;
}): Promise<MultiCompanyDetailsChangeResult> {
  const suffix = preview ? "/preview" : "";
  return requestJson({
    path: `/api/companies/${companyId}/shareholders/${shareholderId}/details-changes${suffix}`,
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export function previewMultiCompanyDetailsChange({
  companyId,
  shareholderId,
  input,
}: MultiCompanyDetailsChangeRequest): Promise<MultiCompanyDetailsChangeResult> {
  return mutateMultiCompanyDetails({ companyId, shareholderId, input, preview: true });
}

export function appendMultiCompanyDetailsChange({
  companyId,
  shareholderId,
  input,
}: MultiCompanyDetailsChangeRequest): Promise<MultiCompanyDetailsChangeResult> {
  return mutateMultiCompanyDetails({ companyId, shareholderId, input, preview: false });
}

export function listShareClasses({ companyId }: CompanyRequest): Promise<ShareClass[]> {
  return requestJson({ path: `/api/companies/${companyId}/share-classes` });
}

export function listEvents({ companyId }: CompanyRequest): Promise<ShareRegisterEvent[]> {
  return requestJson({ path: `/api/companies/${companyId}/events` });
}

export function getCurrentSnapshot({ companyId }: CompanyRequest): Promise<ShareRegisterSnapshot> {
  return requestJson({ path: `/api/companies/${companyId}/snapshot` });
}

export function getHistoricalSnapshot({
  companyId,
  effectiveOn,
  knownAt,
}: CompanyRequest & { effectiveOn: string; knownAt?: string }): Promise<ShareRegisterSnapshot> {
  const query = new URLSearchParams({ effectiveOn });
  if (knownAt) query.set("knownAt", knownAt);
  return requestJson({ path: `/api/companies/${companyId}/snapshot/history?${query}` });
}

export function exportCompanyOcf({
  companyId,
  options,
}: CompanyRequest & { options: OcfCompanyExportOptions }): Promise<OcfExportResult> {
  return requestJson({
    path: `/api/companies/${companyId}/share-register/export/ocf`,
    init: { method: "POST", body: JSON.stringify(options) },
  });
}

type EventRequest = CompanyRequest & { drafts: ShareEventDraft[] };

export function previewEvents({ companyId, drafts }: EventRequest): Promise<EventMutationResult> {
  return requestJson({
    path: `/api/companies/${companyId}/events/preview`,
    init: { method: "POST", body: JSON.stringify(drafts) },
  });
}

export function appendEvents({ companyId, drafts }: EventRequest): Promise<EventMutationResult> {
  return requestJson({
    path: `/api/companies/${companyId}/events`,
    init: { method: "POST", body: JSON.stringify(drafts) },
  });
}

export type {
  OcfConversion,
  OcfDryRunReport,
  OcfDryRunResult,
  OcfImportMode,
  OcfImportOptions,
  OcfInformationLoss,
  OcfIssue,
  OcfPackage,
  OcfProposedCommand,
  OcfRequiredResolution,
  OcfSupportedCounts,
  OcfTransferReasonResolution,
  TransferReason as OcfTransferReason,
} from "../../modules/ocf/types";
export type { ShareClass, Shareholder, ShareRegisterEvent, ShareRegisterSnapshot };
