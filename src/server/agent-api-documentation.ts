type AgentOperation = Readonly<{
  method: "GET" | "POST" | "DELETE";
  path: string;
  purpose: string;
  input?: string;
  result?: string;
  caution?: string;
  adminOnly?: boolean;
}>;

const APPLICATION_OPERATIONS: readonly AgentOperation[] = Object.freeze([
  {
    method: "GET",
    path: "/api/agent",
    purpose: "Return this key-specific API documentation.",
  },
  {
    method: "GET",
    path: "/api/companies",
    purpose: "List every company available in this Stam installation.",
  },
  {
    method: "POST",
    path: "/api/companies",
    purpose: "Create a company, optionally with its first share class.",
    input:
      "JSON company fields: legalName, registrationCountry, registrationScheme, registrationValue, status; optional initialShareClass with name, votesPerShare and effectiveFrom.",
  },
  {
    method: "POST",
    path: "/api/companies/imports/fortnox/preview",
    purpose: "Validate Fortnox register sources and return a non-writing import plan.",
    input:
      "Preferred multipart files: detailedRegisterPdf (PDF), ownerOverviewPdf (PDF), eventsHtml (HTML). Extracted JSON fields detailedRegisterText, ownerOverviewText and eventsHtml are also accepted.",
  },
  {
    method: "POST",
    path: "/api/companies/imports/fortnox",
    purpose: "Atomically commit a previously reviewed Fortnox import payload.",
    input: "The same multipart files or extracted JSON fields as the Fortnox preview operation.",
    caution: "Creates a company and immutable register history.",
  },
  {
    method: "POST",
    path: "/api/companies/imports/ocf/preview",
    purpose: "Validate a supported OCF package and return a non-writing report and plan.",
    input: "JSON: package containing manifest and files, plus import options.",
  },
  {
    method: "POST",
    path: "/api/companies/imports/ocf",
    purpose: "Atomically commit a reviewed supported-profile OCF import.",
    input: "The same JSON fields as the OCF preview operation, including required resolutions.",
    caution: "Creates a company and immutable register history.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}",
    purpose: "Read one company.",
  },
  {
    method: "DELETE",
    path: "/api/companies/{companyId}",
    purpose: "Permanently remove one company and all company-owned records.",
    caution: "Irreversible and restricted to administrators.",
    adminOnly: true,
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/shareholders",
    purpose: "List the company's shareholder catalog.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/shareholders",
    purpose: "Create a shareholder catalog entry without assigning shares.",
    input:
      "JSON shareholder fields including kind, Swedish identifier fields, initialDetails and effectiveFrom; companyId is taken from the path.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/shareholder-copy-candidates",
    purpose: "List matching shareholders that can be copied from other companies.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/shareholders/{shareholderId}/company-matches",
    purpose: "Find the same identified shareholder in other companies.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/shareholders/{shareholderId}/details-changes/preview",
    purpose: "Preview a dated shareholder-details change across selected companies.",
    input: "JSON: targetCompanyIds, effectiveDate and complete after details.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/shareholders/{shareholderId}/details-changes",
    purpose: "Register a previously reviewed shareholder-details change.",
    input: "The same JSON fields as the details-change preview.",
    caution: "Appends immutable events in every selected company.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/share-classes",
    purpose: "List share classes and exact-decimal votes per share.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/share-classes",
    purpose: "Create a share class.",
    input: "JSON: name, votesPerShare and effectiveFrom; companyId is taken from the path.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/events",
    purpose: "List the immutable share-register event history.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/events/preview",
    purpose: "Validate event drafts and return their non-writing projected result.",
    input: "JSON array of drafts with effectiveDate, type and type-specific payload.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/events",
    purpose: "Append validated share-register event drafts.",
    input: "The same JSON draft array as the event preview operation.",
    caution: "Events are immutable; preview first and preserve the returned assumptions.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/snapshot",
    purpose: "Read the current projected register snapshot.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/snapshot/history?effectiveOn={YYYY-MM-DD}&knownAt={UTC timestamp}",
    purpose: "Read a bitemporal historical register snapshot.",
    input: "effectiveOn is required; knownAt is optional and must be a UTC timestamp.",
  },
  {
    method: "GET",
    path: "/api/companies/{companyId}/share-register/export/{html|pdf}?effectiveOn={YYYY-MM-DD}&knownAt={UTC timestamp}",
    purpose: "Download an audited historical HTML or PDF share register.",
  },
  {
    method: "POST",
    path: "/api/companies/{companyId}/share-register/export/ocf",
    purpose: "Validate and return a supported-profile OCF export package.",
    input: "JSON export metadata including formationDate, asOf and stock-class metadata.",
  },
]);

const ADMIN_OPERATIONS: readonly AgentOperation[] = Object.freeze([
  {
    method: "GET",
    path: "/api/admin/directory",
    purpose: "List users and invitations with current roles and invitation statuses.",
    adminOnly: true,
  },
  {
    method: "POST",
    path: "/api/admin/invitations",
    purpose: "Create an invitation and return its one-time acceptance URL.",
    input: "JSON: email, name and optional UTC expiresAt.",
    adminOnly: true,
  },
  {
    method: "DELETE",
    path: "/api/admin/users/{userId}",
    purpose: "Permanently remove another user and revoke all of their credentials.",
    adminOnly: true,
  },
]);

export function createAgentApiDocumentation({
  baseUrl,
  userId,
  roles,
  authentication,
}: {
  baseUrl: string;
  userId: string;
  roles: readonly string[];
  authentication:
    | Readonly<{ method: "SESSION" }>
    | Readonly<{
        method: "API_KEY";
        keyId: string;
        name: string | null;
        startsWith: string | null;
        expiresAt: Date | null;
      }>;
}) {
  const isAdmin = roles.includes("admin");
  return Object.freeze({
    format: "stam-agent-api-v1",
    service: "Stam",
    baseUrl,
    authentication: Object.freeze({
      ...authentication,
      header: authentication.method === "API_KEY" ? "x-api-key" : undefined,
      userId,
      roles,
    }),
    authorization: Object.freeze({
      allCompaniesVisible: true,
      samePermissionsAsOwningUser: authentication.method === "API_KEY",
      administrator: isAdmin,
    }),
    conventions: Object.freeze({
      contentType: "application/json",
      exactDecimals: "Decimal values such as votes per share are JSON strings, never floats.",
      dates: "Effective dates use YYYY-MM-DD; registration cutoffs use UTC timestamps.",
      mutationSafety:
        "Call the matching preview endpoint before registering shareholder-detail or ownership events.",
      errors:
        "Errors use HTTP status codes and JSON with an error message; validation may include issues.",
    }),
    operations: Object.freeze([
      ...APPLICATION_OPERATIONS.filter((operation) => !operation.adminOnly || isAdmin),
      ...(isAdmin ? ADMIN_OPERATIONS : []),
    ]),
  });
}
