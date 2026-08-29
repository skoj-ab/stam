import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { readEnvironment } from "../../src/config/environment.ts";
import { type DatabaseContext, openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import {
  apikey,
  applicationAuditEvents,
  companies,
  currentShareholderDetails,
  currentShareRanges,
  invitations,
  shareClasses,
  shareEvents,
  shareholders,
  user,
} from "../../src/db/schema.ts";
import { listAuditEvents } from "../../src/modules/audit/index.ts";
import {
  bootstrapFirstAdmin,
  createAuth,
  hashInvitationToken,
} from "../../src/modules/auth/index.ts";
import { exportOcfPackage, type OcfPackage } from "../../src/modules/ocf/index.ts";
import { createApp } from "../../src/server/app.ts";
import { syntheticFortnoxFiles, syntheticFortnoxImport } from "../fixtures/fortnox.ts";
import { ocfExportSource } from "../modules/ocf-fixture.ts";

const publicOrigin = "http://localhost:5174";
const password = "correct-horse-battery-staple";

function environment(databasePath: string) {
  return readEnvironment({
    NODE_ENV: "test",
    PORT: "3100",
    DATABASE_PATH: databasePath,
    PUBLIC_ORIGIN: publicOrigin,
    AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
    WEBAUTHN_RP_ID: "localhost",
  });
}

async function withTestApp<T>(
  operation: (
    app: ReturnType<typeof createApp>,
    database: DatabaseContext,
    auth: ReturnType<typeof createAuth>,
  ) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "stam-server-api-"));
  const databasePath = join(directory, "stam.sqlite");
  const database = openDatabase(databasePath);
  try {
    migrateDatabase(database);
    const testEnvironment = environment(databasePath);
    const auth = createAuth(database, testEnvironment);
    return await operation(createApp(database, auth, testEnvironment), database, auth);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function signIn(
  app: ReturnType<typeof createApp>,
  email: string,
  userPassword = password,
): Promise<string> {
  const response = await app.request(`${publicOrigin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: publicOrigin },
    body: JSON.stringify({ email, password: userPassword }),
  });
  expect(response.status).toBe(200);
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter((value) => value !== undefined);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

function request(
  app: ReturnType<typeof createApp>,
  path: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
    formData?: FormData;
    origin?: string | null;
    apiKey?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined && options.formData) throw new Error("Choose JSON or form data");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.apiKey) headers.set("x-api-key", options.apiKey);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== null && options.method && !["GET", "HEAD"].includes(options.method)) {
    headers.set("origin", options.origin ?? publicOrigin);
  }
  return Promise.resolve(
    app.request(`${publicOrigin}${path}`, {
      method: options.method,
      headers,
      body:
        options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    }),
  );
}

async function createApiKey(client: ApiClient, name: string): Promise<string> {
  const response = await request(client.app, "/api/auth/api-key/create", {
    method: "POST",
    cookie: client.cookie,
    body: { name, expiresIn: 365 * 24 * 60 * 60 },
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { key: string };
  expect(result.key).toStartWith("stam_");
  return result.key;
}

async function createInvitationThroughApi(
  client: ApiClient,
  email: string,
): Promise<{ id: string; token: string }> {
  const response = await request(client.app, "/api/admin/invitations", {
    method: "POST",
    cookie: client.cookie,
    body: { email, name: email.split("@")[0] ?? email },
  });
  expect(response.status).toBe(201);
  const result = (await response.json()) as { invitation: { id: string }; token: string };
  return { id: result.invitation.id, token: result.token };
}

function requireUserByEmail(database: DatabaseContext, email: string) {
  const result = database.db.select().from(user).where(eq(user.email, email)).get();
  if (!result) throw new Error(`Expected user ${email}`);
  return result;
}

async function revokeApiKey(
  client: ApiClient,
  database: DatabaseContext,
  ownerEmail: string,
  rawKey: string,
): Promise<void> {
  const owner = requireUserByEmail(database, ownerEmail);
  const key = database.db
    .select({ id: apikey.id })
    .from(apikey)
    .where(eq(apikey.referenceId, owner.id))
    .get();
  if (!key) throw new Error(`Expected an API key for ${ownerEmail}`);
  const revoked = await request(client.app, "/api/auth/api-key/delete", {
    method: "POST",
    cookie: client.cookie,
    body: { keyId: key.id },
  });
  expect(revoked.status).toBe(200);
  expect((await request(client.app, "/api/companies", { apiKey: rawKey })).status).toBe(401);
}

function validOcfPackage(): OcfPackage {
  const exported = exportOcfPackage(ocfExportSource(), {
    generatedAt: "2024-12-31T12:00:00Z",
  });
  if (!exported.package) throw new Error(JSON.stringify(exported.report.issues));
  return exported.package;
}

async function verifyUnresolvedOcfImport(
  client: ApiClient,
  database: DatabaseContext,
  pkg: OcfPackage,
): Promise<void> {
  const body = { package: pkg, options: { mode: "TRANSACTION_HISTORY" } };
  const preview = await request(client.app, "/api/companies/imports/ocf/preview", {
    method: "POST",
    cookie: client.cookie,
    body,
  });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    report: {
      valid: false,
      requiredResolutions: [{ sourceTransactionId: "transfer-1" }],
    },
  });
  expect(database.db.select().from(companies).all()).toEqual([]);

  const commit = await request(client.app, "/api/companies/imports/ocf", {
    method: "POST",
    cookie: client.cookie,
    body,
  });
  expect(commit.status).toBe(422);
  expect(await commit.json()).toMatchObject({ report: { valid: false } });
  expect(database.db.select().from(companies).all()).toEqual([]);
}

async function commitOcfProfile(client: ApiClient, pkg: OcfPackage) {
  const committed = await request(client.app, "/api/companies/imports/ocf", {
    method: "POST",
    cookie: client.cookie,
    body: {
      package: pkg,
      options: {
        mode: "TRANSACTION_HISTORY",
        transferReasonResolutions: { "transfer-1": { reason: "SALE" } },
      },
    },
  });
  expect(committed.status).toBe(201);
  return (await committed.json()) as {
    company: { id: string };
    shareClasses: Array<{ id: string }>;
  };
}

async function verifyOcfExport(
  client: ApiClient,
  imported: Awaited<ReturnType<typeof commitOcfProfile>>,
): Promise<void> {
  const shareClassId = imported.shareClasses[0]?.id;
  if (!shareClassId) throw new Error("Expected an imported share class");
  const response = await request(
    client.app,
    `/api/companies/${imported.company.id}/share-register/export/ocf`,
    {
      method: "POST",
      cookie: client.cookie,
      body: {
        formationDate: "2019-01-01",
        asOf: "2024-12-31",
        stockClasses: {
          [shareClassId]: {
            classType: "COMMON",
            defaultIdPrefix: "A-",
            initialSharesAuthorized: "1000",
            seniority: "1",
          },
        },
      },
    },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    package: { manifest: { ocf_version: "1.2.0" } },
    report: { valid: true },
  });
}

function shareholderDetails(legalName: string) {
  return {
    legalName,
    address: {
      lines: [`${legalName} street 1`],
      postalCode: "111 11",
      locality: "Stockholm",
      countryCode: "SE",
    },
  };
}

type TestApp = ReturnType<typeof createApp>;
type ApiClient = Readonly<{ app: TestApp; cookie: string }>;
type AuthenticatedUsers = Readonly<{ admin: ApiClient; user: ApiClient }>;
type CompanyRef = Readonly<{ id: string; registrationValue: string }>;
type Catalog = Readonly<{
  companyId: string;
  aliceId: string;
  bobId: string;
  shareClassId: string;
}>;

async function createAuthenticatedUsers(
  app: TestApp,
  database: DatabaseContext,
  auth: ReturnType<typeof createAuth>,
): Promise<AuthenticatedUsers> {
  await bootstrapFirstAdmin(auth, database, {
    email: "admin@example.com",
    name: "Administrator",
    password,
  });
  await auth.api.createUser({
    body: { email: "user@example.com", name: "Ordinary User", password },
  });
  return {
    admin: { app, cookie: await signIn(app, "admin@example.com") },
    user: { app, cookie: await signIn(app, "user@example.com") },
  };
}

async function createCompanyAndCheckGlobalAccess(users: AuthenticatedUsers): Promise<CompanyRef> {
  const created = await request(users.admin.app, "/api/companies", {
    method: "POST",
    cookie: users.admin.cookie,
    body: {
      legalName: "Example AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556016-0680",
      initialShareClass: { name: "A", votesPerShare: "1", effectiveFrom: "2024-01-01" },
    },
  });
  expect(created.status).toBe(201);
  const company = (await created.json()) as CompanyRef;
  expect(company.registrationValue).toBe("5560160680");

  const listed = await request(users.user.app, "/api/companies", { cookie: users.user.cookie });
  expect(await listed.json()).toContainEqual(
    expect.objectContaining({ id: company.id, legalName: "Example AB" }),
  );
  const duplicate = await request(users.user.app, "/api/companies", {
    method: "POST",
    cookie: users.user.cookie,
    body: {
      legalName: "Duplicate AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "5560160680",
    },
  });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "Resource already exists" });

  const session = await request(users.user.app, "/api/session", { cookie: users.user.cookie });
  expect(await session.json()).toMatchObject({
    user: { email: "user@example.com", name: "Ordinary User" },
  });
  return company;
}

async function createCatalog(client: ApiClient, company: CompanyRef): Promise<Catalog> {
  const aliceResponse = await request(client.app, `/api/companies/${company.id}/shareholders`, {
    method: "POST",
    cookie: client.cookie,
    body: {
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "811218-9876",
      initialDetails: shareholderDetails("Alice Andersson"),
      effectiveFrom: "2024-01-01",
    },
  });
  const bobResponse = await request(client.app, `/api/companies/${company.id}/shareholders`, {
    method: "POST",
    cookie: client.cookie,
    body: {
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "640823-3234",
      initialDetails: shareholderDetails("Bob Berg"),
      effectiveFrom: "2024-01-01",
    },
  });
  expect([aliceResponse.status, bobResponse.status]).toEqual([201, 201]);

  const shareholders = await request(client.app, `/api/companies/${company.id}/shareholders`, {
    cookie: client.cookie,
  });
  const shareClasses = await request(client.app, `/api/companies/${company.id}/share-classes`, {
    cookie: client.cookie,
  });
  expect((await shareholders.json()) as unknown[]).toHaveLength(2);
  const classes = (await shareClasses.json()) as Array<{ id: string; name: string }>;
  expect(classes).toHaveLength(1);
  expect(classes[0]?.name).toBe("A");
  return {
    companyId: company.id,
    aliceId: ((await aliceResponse.json()) as { id: string }).id,
    bobId: ((await bobResponse.json()) as { id: string }).id,
    shareClassId: classes[0]?.id ?? "",
  };
}

async function createMatchingShareholder(client: ApiClient) {
  const companyResponse = await request(client.app, "/api/companies", {
    method: "POST",
    cookie: client.cookie,
    body: {
      legalName: "Second AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556036-0793",
    },
  });
  expect(companyResponse.status).toBe(201);
  const company = (await companyResponse.json()) as CompanyRef;
  const shareholderResponse = await request(
    client.app,
    `/api/companies/${company.id}/shareholders`,
    {
      method: "POST",
      cookie: client.cookie,
      body: {
        kind: "INDIVIDUAL",
        identifierCountryCode: "SE",
        identifierScheme: "PERSONNUMMER",
        identifierValue: "811218-9876",
        initialDetails: shareholderDetails("Alice Andersson"),
        effectiveFrom: "2024-01-01",
      },
    },
  );
  expect(shareholderResponse.status).toBe(201);
  return {
    company,
    shareholder: (await shareholderResponse.json()) as { id: string },
  };
}

function openingDraftBatch(catalog: Catalog) {
  return [
    {
      effectiveDate: "2024-01-01",
      type: "OPENING_STATE_IMPORTED",
      payload: {
        holdings: [
          {
            shareholderId: catalog.aliceId,
            shareClassId: catalog.shareClassId,
            ranges: [{ from: 1, to: 100 }],
          },
        ],
        sourceType: "SHARE_REGISTER",
        importNote: "Verified opening register",
      },
    },
  ];
}

async function openAndReadRegister(client: ApiClient, catalog: Catalog): Promise<void> {
  const openingResponse = await request(client.app, `/api/companies/${catalog.companyId}/events`, {
    method: "POST",
    cookie: client.cookie,
    body: openingDraftBatch(catalog),
  });
  expect(openingResponse.status).toBe(201);
  const opening = (await openingResponse.json()) as { events: Array<{ registeredAt: string }> };

  const events = await request(client.app, `/api/companies/${catalog.companyId}/events`, {
    cookie: client.cookie,
  });
  expect((await events.json()) as unknown[]).toHaveLength(1);
  const current = await request(client.app, `/api/companies/${catalog.companyId}/snapshot`, {
    cookie: client.cookie,
  });
  expect(await current.json()).toMatchObject({
    holdings: [{ shareholderId: catalog.aliceId, range: { from: 1, to: 100 } }],
  });
  const knownAt = encodeURIComponent(opening.events[0]?.registeredAt ?? "");
  const historical = await request(
    client.app,
    `/api/companies/${catalog.companyId}/snapshot/history?effectiveOn=2024-12-31&knownAt=${knownAt}`,
    { cookie: client.cookie },
  );
  expect(historical.status).toBe(200);
  expect(await historical.json()).toMatchObject({ effectiveOn: "2024-12-31" });

  const htmlExport = await request(
    client.app,
    `/api/companies/${catalog.companyId}/share-register/export/html?effectiveOn=2024-12-31&knownAt=${knownAt}`,
    { cookie: client.cookie },
  );
  expect(htmlExport.status).toBe(200);
  expect(htmlExport.headers.get("content-type")).toContain("text/html");
  expect(htmlExport.headers.get("content-disposition")).toContain("aktiebok-");
  expect(await htmlExport.text()).toContain("Aktiebok för Example AB");

  const pdfExport = await request(
    client.app,
    `/api/companies/${catalog.companyId}/share-register/export/pdf?effectiveOn=2024-12-31&knownAt=${knownAt}`,
    { cookie: client.cookie },
  );
  expect(pdfExport.status).toBe(200);
  expect(pdfExport.headers.get("content-type")).toContain("application/pdf");
  expect(new TextDecoder().decode((await pdfExport.bytes()).slice(0, 5))).toBe("%PDF-");

  const eventsAfterExports = await request(
    client.app,
    `/api/companies/${catalog.companyId}/events`,
    { cookie: client.cookie },
  );
  expect((await eventsAfterExports.json()) as unknown[]).toHaveLength(1);
}

async function checkEventConflictAndOriginProtection(
  client: ApiClient,
  catalog: Catalog,
): Promise<void> {
  const invalidTransfer = await request(client.app, `/api/companies/${catalog.companyId}/events`, {
    method: "POST",
    cookie: client.cookie,
    body: [
      {
        effectiveDate: "2024-02-01",
        type: "SHARES_TRANSFERRED",
        payload: {
          transferorId: catalog.bobId,
          transfereeId: catalog.aliceId,
          shareClassId: catalog.shareClassId,
          ranges: [{ from: 1, to: 10 }],
          reason: "SALE",
        },
      },
    ],
  });
  expect(invalidTransfer.status).toBe(409);
  expect(await invalidTransfer.json()).toMatchObject({ code: "INVALID_OWNERSHIP" });

  const wrongOrigin = await request(client.app, "/api/companies", {
    method: "POST",
    cookie: client.cookie,
    origin: "https://attacker.example",
    body: {},
  });
  const missingOrigin = await request(client.app, "/api/companies", {
    method: "POST",
    cookie: client.cookie,
    origin: null,
    body: {},
  });
  expect([wrongOrigin.status, missingOrigin.status]).toEqual([403, 403]);
}

async function previewOpening(client: ApiClient, catalog: Catalog) {
  const response = await request(client.app, `/api/companies/${catalog.companyId}/events/preview`, {
    method: "POST",
    cookie: client.cookie,
    body: openingDraftBatch(catalog),
  });
  expect(response.status).toBe(200);
  const preview = (await response.json()) as {
    events: Array<{ id: string; companyId: string; sequence: number; type: string }>;
    currentSnapshot: {
      companyId: string;
      holdings: unknown[];
      totalsByClass: unknown[];
      appliedEventIds: string[];
      lastAppliedSequence?: number;
    };
  };
  expect(preview.events).toMatchObject([
    { companyId: catalog.companyId, sequence: 1, type: "OPENING_STATE_IMPORTED" },
  ]);
  expect(preview.currentSnapshot).toMatchObject({
    companyId: catalog.companyId,
    holdings: [
      {
        shareholderId: catalog.aliceId,
        shareClassId: catalog.shareClassId,
        range: { from: 1, to: 100 },
      },
    ],
    totalsByClass: [{ shareClassId: catalog.shareClassId, total: 100 }],
    appliedEventIds: [preview.events[0]?.id],
    lastAppliedSequence: 1,
  });
}

async function compareInvalidPreviewAndAppend(client: ApiClient, catalog: Catalog) {
  const invalidDraft = [
    {
      effectiveDate: "2024-02-01",
      type: "SHARES_TRANSFERRED",
      payload: {
        transferorId: catalog.bobId,
        transfereeId: catalog.aliceId,
        shareClassId: catalog.shareClassId,
        ranges: [{ from: 1, to: 10 }],
        reason: "SALE",
      },
    },
  ];
  const path = `/api/companies/${catalog.companyId}/events`;
  const invalidPreview = await request(client.app, `${path}/preview`, {
    method: "POST",
    cookie: client.cookie,
    body: invalidDraft,
  });
  const invalidAppend = await request(client.app, path, {
    method: "POST",
    cookie: client.cookie,
    body: invalidDraft,
  });
  expect([invalidPreview.status, invalidAppend.status]).toEqual([409, 409]);
  const invalidPreviewBody = await invalidPreview.json();
  expect(invalidPreviewBody).toMatchObject({ code: "MISSING_OPENING" });
  expect(invalidPreviewBody).toEqual(await invalidAppend.json());
}

async function expectPreviewHasNoSideEffects(
  client: ApiClient,
  database: DatabaseContext,
  companyId: string,
) {
  const companyResponse = await request(client.app, `/api/companies/${companyId}`, {
    cookie: client.cookie,
  });
  expect(await companyResponse.json()).toMatchObject({ status: "DRAFT" });
  const eventsResponse = await request(client.app, `/api/companies/${companyId}/events`, {
    cookie: client.cookie,
  });
  expect(await eventsResponse.json()).toEqual([]);
  expect(
    database.db.select().from(shareEvents).where(eq(shareEvents.companyId, companyId)).all(),
  ).toHaveLength(0);
  expect(
    database.db
      .select()
      .from(currentShareRanges)
      .where(eq(currentShareRanges.companyId, companyId))
      .all(),
  ).toHaveLength(0);
  expect(
    database.db
      .select()
      .from(currentShareholderDetails)
      .where(eq(currentShareholderDetails.companyId, companyId))
      .all(),
  ).toHaveLength(0);
}

async function previewFortnoxCompany(client: ApiClient, database: DatabaseContext): Promise<void> {
  const files = await syntheticFortnoxFiles();
  const formData = new FormData();
  for (const [field, file] of Object.entries(files)) formData.append(field, file);
  const preview = await request(client.app, "/api/companies/imports/fortnox/preview", {
    method: "POST",
    cookie: client.cookie,
    formData,
  });
  expect(preview.status).toBe(200);
  const previewBody = (await preview.json()) as {
    plan: { company: object; shareClass: object; sourceEvents: object[] };
  };
  expect(previewBody).toMatchObject({
    plan: {
      company: { legalName: "Exempelimport AB", registrationValue: "5560160680" },
      shareClass: { totalShares: 3 },
    },
  });
  expect(previewBody.plan.sourceEvents).toEqual(
    expect.arrayContaining([expect.objectContaining({ handling: "RECORDED_AS_SOURCE" })]),
  );
  expect(database.db.select().from(companies).all()).toHaveLength(0);
  expect(database.db.select().from(shareholders).all()).toHaveLength(0);
  expect(database.db.select().from(shareClasses).all()).toHaveLength(0);
  expect(database.db.select().from(shareEvents).all()).toHaveLength(0);
}

async function commitFortnoxCompany(client: ApiClient, database: DatabaseContext): Promise<void> {
  const files = await syntheticFortnoxFiles();
  const formData = new FormData();
  for (const [field, file] of Object.entries(files)) formData.append(field, file);
  const committed = await request(client.app, "/api/companies/imports/fortnox", {
    method: "POST",
    cookie: client.cookie,
    formData,
  });
  expect(committed.status).toBe(201);
  const result = (await committed.json()) as {
    company: { id: string; status: string };
    events: Array<{ type: string; operationId: string }>;
    currentSnapshot: {
      shareCapital: { amount: string };
      totalsByClass: Array<{ total: number }>;
    };
  };
  expect(result.company.status).toBe("ACTIVE");
  expect(result.events.map(({ type }) => type)).toEqual([
    "SOURCE_ACTIVITY_RECORDED",
    "SOURCE_ACTIVITY_RECORDED",
    "SHARE_CAPITAL_CHANGED",
    "OPENING_STATE_IMPORTED",
  ]);
  expect(result.currentSnapshot).toMatchObject({
    shareCapital: { amount: "30" },
    totalsByClass: [{ total: 3 }],
  });
  expect(
    database.db
      .select()
      .from(applicationAuditEvents)
      .where(eq(applicationAuditEvents.type, "IMPORT_COMMITTED"))
      .all(),
  ).toHaveLength(1);
}

describe("HTTP application composition", () => {
  test("keeps health public, protects application APIs, and sets secure headers", async () => {
    await withTestApp(async (app) => {
      const health = await request(app, "/api/health");
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: "ok" });
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");

      const protectedResponse = await request(app, "/api/companies");
      expect(protectedResponse.status).toBe(401);
      expect(await protectedResponse.json()).toEqual({ error: "Unauthorized" });
    });
  });

  test("previews and atomically commits a new Fortnox company", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      await previewFortnoxCompany(users.user, database);
      await commitFortnoxCompany(users.user, database);

      const repeated = await request(app, "/api/companies/imports/fortnox", {
        method: "POST",
        cookie: users.user.cookie,
        body: syntheticFortnoxImport,
      });
      expect(repeated.status).toBe(409);
      expect(database.db.select().from(companies).all()).toHaveLength(1);
      const invalid = await request(app, "/api/companies/imports/fortnox/preview", {
        method: "POST",
        cookie: users.user.cookie,
        body: { ...syntheticFortnoxImport, detailedRegisterText: "not a register" },
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: "Invalid request", issues: [{}] });

      const uploadFiles = await syntheticFortnoxFiles();
      const invalidUpload = new FormData();
      invalidUpload.append(
        "detailedRegisterPdf",
        new File(["not a PDF"], "aktiebok.pdf", { type: "application/pdf" }),
      );
      invalidUpload.append("ownerOverviewPdf", uploadFiles.ownerOverviewPdf);
      invalidUpload.append("eventsHtml", uploadFiles.eventsHtml);
      const invalidPdf = await request(app, "/api/companies/imports/fortnox/preview", {
        method: "POST",
        cookie: users.user.cookie,
        formData: invalidUpload,
      });
      expect(invalidPdf.status).toBe(400);
    });
  });

  test("reports, resolves, commits, and exports the supported OCF profile", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const pkg = validOcfPackage();
      await verifyUnresolvedOcfImport(users.user, database, pkg);
      await verifyOcfExport(users.user, await commitOcfProfile(users.user, pkg));
    });
  });

  test("allows every authenticated user to manage catalogs, events, and snapshots", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const company = await createCompanyAndCheckGlobalAccess(users);
      const catalog = await createCatalog(users.user, company);
      await openAndReadRegister(users.user, catalog);
      await checkEventConflictAndOriginProtection(users.user, catalog);

      const auditEvents = listAuditEvents(database);
      expect(auditEvents.map(({ type }) => type)).toEqual(
        expect.arrayContaining(["AUTH_ADMINISTRATION", "AUTH_LOGIN", "IMPORT_COMMITTED"]),
      );
      expect(auditEvents.filter(({ type }) => type === "EXPORT_GENERATED")).toHaveLength(2);
      expect(JSON.stringify(auditEvents)).not.toContain(password);
      expect(() =>
        database.db
          .update(applicationAuditEvents)
          .set({ outcome: "FAILED" })
          .where(eq(applicationAuditEvents.sequence, auditEvents[0]?.sequence ?? 0))
          .run(),
      ).toThrow("application audit events are immutable");
      expect(() =>
        database.db
          .delete(applicationAuditEvents)
          .where(eq(applicationAuditEvents.sequence, auditEvents[0]?.sequence ?? 0))
          .run(),
      ).toThrow("application audit events are immutable");
    });
  });

  test("previews and appends details changes for matching shareholders", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const company = await createCompanyAndCheckGlobalAccess(users);
      const catalog = await createCatalog(users.user, company);
      const second = await createMatchingShareholder(users.user);
      const path = `/api/companies/${company.id}/shareholders/${catalog.aliceId}`;

      const matchesResponse = await request(app, `${path}/company-matches`, {
        cookie: users.user.cookie,
      });
      expect(matchesResponse.status).toBe(200);
      expect(await matchesResponse.json()).toMatchObject([
        { company: { id: company.id }, shareholderId: catalog.aliceId },
        { company: { id: second.company.id }, shareholderId: second.shareholder.id },
      ]);

      const input = {
        targetCompanyIds: [company.id, second.company.id],
        effectiveDate: "2024-05-01",
        after: shareholderDetails("Alice Updated"),
      };
      const eventsBefore = database.db.select().from(shareEvents).all().length;
      const previewResponse = await request(app, `${path}/details-changes/preview`, {
        method: "POST",
        cookie: users.user.cookie,
        body: input,
      });
      expect(previewResponse.status).toBe(200);
      expect((await previewResponse.json()) as { results: unknown[] }).toMatchObject({
        results: [{ company: { id: company.id } }, { company: { id: second.company.id } }],
      });
      expect(database.db.select().from(shareEvents).all()).toHaveLength(eventsBefore);

      const appendResponse = await request(app, `${path}/details-changes`, {
        method: "POST",
        cookie: users.user.cookie,
        body: input,
      });
      expect(appendResponse.status).toBe(201);
      const appended = (await appendResponse.json()) as {
        results: Array<{ events: Array<{ operationId: string }> }>;
      };
      expect(appended.results).toHaveLength(2);
      expect(new Set(appended.results.map(({ events }) => events[0]?.operationId)).size).toBe(1);

      for (const companyId of [company.id, second.company.id]) {
        const snapshot = await request(app, `/api/companies/${companyId}/snapshot`, {
          cookie: users.user.cookie,
        });
        const body = (await snapshot.json()) as {
          shareholderDetails: Array<{ details: { legalName: string } }>;
        };
        expect(body.shareholderDetails.map(({ details }) => details.legalName)).toContain(
          "Alice Updated",
        );
      }
    });
  });

  test("previews event batches without changing persisted register state", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const company = await createCompanyAndCheckGlobalAccess(users);
      const catalog = await createCatalog(users.user, company);
      const auditCount = listAuditEvents(database).length;
      const unauthorizedBootstrap = await request(app, `/api/companies/${company.id}/events`, {
        method: "POST",
        cookie: users.user.cookie,
        body: [
          {
            effectiveDate: "2024-01-01",
            type: "OPENING_STATE_IMPORTED",
            payload: {
              holdings: [],
              sourceType: "OCF",
              importNote: "Attempted generic API bootstrap",
            },
          },
        ],
      });
      expect(unauthorizedBootstrap.status).toBe(409);
      await previewOpening(users.user, catalog);
      await compareInvalidPreviewAndAppend(users.user, catalog);
      await expectPreviewHasNoSideEffects(users.user, database, company.id);
      expect(listAuditEvents(database)).toHaveLength(auditCount);
    });
  });

  test("lets only global administrators create opaque passwordless invitations", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);

      const forbidden = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.user.cookie,
        body: { email: "blocked@example.com", name: "Blocked User" },
      });
      expect(forbidden.status).toBe(403);
      expect(
        database.db.select().from(user).where(eq(user.email, "blocked@example.com")).get(),
      ).toBe(undefined);

      const response = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invitee@example.com", name: "Invited User" },
      });
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        invitation: { id: string; userId: string };
        token: string;
        acceptanceUrl: string;
      };
      expect(result.acceptanceUrl).toBe(
        `${publicOrigin}/accept-invitation?token=${encodeURIComponent(result.token)}`,
      );

      const target = database.db
        .select()
        .from(user)
        .where(eq(user.id, result.invitation.userId))
        .get();
      expect(target).toMatchObject({ email: "invitee@example.com", name: "Invited User" });
      const stored = database.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, result.invitation.id))
        .get();
      expect(stored?.tokenHash).toBe(hashInvitationToken(result.token));
      expect(stored?.tokenHash).not.toContain(result.token);
      expect(
        listAuditEvents(database).filter(({ type }) => type === "INVITATION_CREATED"),
      ).toHaveLength(1);

      const recovery = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invitee@example.com", name: "Invited User" },
      });
      expect(recovery.status).toBe(201);
      expect(
        listAuditEvents(database).filter(({ type }) => type === "INVITATION_CREATED"),
      ).toHaveLength(2);
      expect(
        database.db.select().from(user).where(eq(user.email, "invitee@example.com")).all(),
      ).toHaveLength(1);

      const mismatchedRecovery = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invitee@example.com", name: "Different Name" },
      });
      expect(mismatchedRecovery.status).toBe(409);
      expect(await mismatchedRecovery.json()).toMatchObject({
        code: "INVITATION_IDENTITY_MISMATCH",
      });
    });
  });

  test("lists users and invitations with derived status and current role", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const pending = await createInvitationThroughApi(users.admin, "pending@example.com");
      const expired = await createInvitationThroughApi(users.admin, "expired@example.com");
      const consumed = await createInvitationThroughApi(users.admin, "consumed@example.com");
      database.db
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(invitations.id, expired.id))
        .run();
      database.db
        .update(invitations)
        .set({ consumedAt: new Date(), expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(invitations.id, consumed.id))
        .run();

      const forbidden = await request(app, "/api/admin/directory", { cookie: users.user.cookie });
      expect(forbidden.status).toBe(403);
      const response = await request(app, "/api/admin/directory", { cookie: users.admin.cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const directory = (await response.json()) as {
        users: Array<{ email: string; roles: string[]; removable: boolean }>;
        invitations: Array<{ id: string; status: string; roles: string[] }>;
      };
      expect(directory.users).toContainEqual(
        expect.objectContaining({
          email: "admin@example.com",
          roles: ["admin"],
          removable: false,
        }),
      );
      expect(directory.users).toContainEqual(
        expect.objectContaining({ email: "user@example.com", removable: true }),
      );
      expect(directory.invitations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: pending.id, status: "PENDING", roles: ["user"] }),
          expect.objectContaining({ id: expired.id, status: "EXPIRED", roles: ["user"] }),
          expect.objectContaining({ id: consumed.id, status: "CONSUMED", roles: ["user"] }),
        ]),
      );
      const serialized = JSON.stringify(directory);
      expect(serialized).not.toContain(pending.token);
      expect(serialized).not.toContain("tokenHash");
    });
  });

  test("lets administrators remove other users and revoke their credentials", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const admin = requireUserByEmail(database, "admin@example.com");
      const target = requireUserByEmail(database, "user@example.com");

      const forbidden = await request(app, `/api/admin/users/${admin.id}`, {
        method: "DELETE",
        cookie: users.user.cookie,
      });
      expect(forbidden.status).toBe(403);
      const selfRemoval = await request(app, `/api/admin/users/${admin.id}`, {
        method: "DELETE",
        cookie: users.admin.cookie,
      });
      expect(selfRemoval.status).toBe(409);
      expect(database.db.select().from(user).where(eq(user.id, admin.id)).get()).toBeDefined();

      const targetKey = await createApiKey(users.user, "Soon removed");
      database.db.update(user).set({ role: "admin" }).where(eq(user.id, target.id)).run();
      const createdInvitation = await createInvitationThroughApi(
        users.user,
        "invited-by-removed@example.com",
      );

      const incompleteBuiltInRoute = await request(app, "/api/auth/admin/remove-user", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { userId: target.id },
      });
      expect(incompleteBuiltInRoute.status).toBe(404);

      const removed = await request(app, `/api/admin/users/${target.id}`, {
        method: "DELETE",
        cookie: users.admin.cookie,
      });
      expect(removed.status).toBe(204);
      expect(database.db.select().from(user).where(eq(user.id, target.id)).get()).toBeUndefined();
      expect(
        database.db.select().from(apikey).where(eq(apikey.referenceId, target.id)).all(),
      ).toHaveLength(0);
      expect(
        database.db
          .select()
          .from(invitations)
          .where(eq(invitations.id, createdInvitation.id))
          .get(),
      ).toBeUndefined();
      expect((await request(app, "/api/companies", { cookie: users.user.cookie })).status).toBe(
        401,
      );
      expect((await request(app, "/api/companies", { apiKey: targetKey })).status).toBe(401);
      expect(listAuditEvents(database)).toContainEqual(
        expect.objectContaining({
          type: "AUTH_ADMINISTRATION",
          actorUserId: admin.id,
          targetKind: "USER",
          targetId: target.id,
          payload: { action: "REMOVE_USER" },
        }),
      );

      const missing = await request(app, `/api/admin/users/${target.id}`, {
        method: "DELETE",
        cookie: users.admin.cookie,
      });
      expect(missing.status).toBe(404);
    });
  });

  test("uses user-owned API keys for the application API and key-specific agent docs", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createAuthenticatedUsers(app, database, auth);
      const adminKey = await createApiKey(users.admin, "Admin agent");
      const userKey = await createApiKey(users.user, "Ordinary agent");
      const storedKeys = database.db.select().from(apikey).all();
      expect(storedKeys).toHaveLength(2);
      expect(JSON.stringify(storedKeys)).not.toContain(adminKey);

      const created = await request(app, "/api/companies", {
        method: "POST",
        apiKey: adminKey,
        origin: null,
        body: {
          legalName: "Agentbolaget AB",
          registrationCountry: "SE",
          registrationScheme: "ORGANISATIONSNUMMER",
          registrationValue: "5560160680",
        },
      });
      expect(created.status).toBe(201);
      expect((await request(app, "/api/companies", { apiKey: userKey })).status).toBe(200);

      const keySession = await request(app, "/api/session", { apiKey: adminKey });
      expect(keySession.status).toBe(200);
      expect(JSON.stringify(await keySession.json())).not.toContain(adminKey);
      const adminDocs = await request(app, "/api/agent", { apiKey: adminKey });
      expect(adminDocs.status).toBe(200);
      expect(await adminDocs.json()).toMatchObject({
        format: "stam-agent-api-v1",
        authentication: { method: "API_KEY", roles: ["admin"], header: "x-api-key" },
        authorization: { allCompaniesVisible: true, administrator: true },
        operations: expect.arrayContaining([
          expect.objectContaining({ method: "GET", path: "/api/admin/directory" }),
          expect.objectContaining({ method: "DELETE", path: "/api/admin/users/{userId}" }),
          expect.objectContaining({ method: "DELETE", path: "/api/companies/{companyId}" }),
        ]),
      });

      const userDocs = (await (await request(app, "/api/agent", { apiKey: userKey })).json()) as {
        operations: Array<{ method: string; path: string }>;
      };
      expect(userDocs.operations.map(({ path }) => path)).not.toContain("/api/admin/directory");
      expect(userDocs.operations.map(({ path }) => path)).not.toContain(
        "/api/admin/users/{userId}",
      );
      expect(userDocs.operations).not.toContainEqual(
        expect.objectContaining({ method: "DELETE", path: "/api/companies/{companyId}" }),
      );

      const authSession = await request(app, "/api/auth/get-session", { apiKey: adminKey });
      expect(await authSession.json()).toBeNull();
      const cannotMint = await request(app, "/api/auth/api-key/create", {
        method: "POST",
        apiKey: adminKey,
        origin: null,
        body: { name: "Nested key" },
      });
      expect(cannotMint.status).not.toBe(200);

      await revokeApiKey(users.user, database, "user@example.com", userKey);
      expect(JSON.stringify(listAuditEvents(database))).not.toContain(adminKey);
      expect(JSON.stringify(listAuditEvents(database))).not.toContain(userKey);
    });
  });
});
