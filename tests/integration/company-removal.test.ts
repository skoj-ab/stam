import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { readEnvironment } from "../../src/config/environment.ts";
import { type DatabaseContext, openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import {
  applicationAuditEvents,
  companies,
  currentShareholderDetails,
  currentShareRanges,
  shareClasses,
  shareEvents,
  shareholders,
} from "../../src/db/schema.ts";
import { recordAuditEvent } from "../../src/modules/audit/index.ts";
import { bootstrapFirstAdmin, createAuth } from "../../src/modules/auth/index.ts";
import { createCompany, getCompany, removeCompany } from "../../src/modules/companies/index.ts";
import { createShareClass } from "../../src/modules/share-classes/index.ts";
import { appendShareEvents } from "../../src/modules/share-events/index.ts";
import { createShareholder } from "../../src/modules/shareholders/index.ts";
import { createApp } from "../../src/server/app.ts";

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");
const publicOrigin = "http://localhost:5174";
const password = "correct-horse-battery-staple";

type ActorFixture = Readonly<{ database: DatabaseContext; actorUserId: string }>;
type CompanyFixture = ActorFixture & Readonly<{ companyId: string }>;

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

function createTestShareholder({ database, companyId, actorUserId }: CompanyFixture) {
  return createShareholder(
    database,
    {
      companyId,
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "811218-9876",
      initialDetails: {
        legalName: "Känslig Aktieägare",
        address: {
          lines: ["Privatgatan 1"],
          postalCode: "111 11",
          locality: "Stockholm",
          countryCode: "SE",
        },
      },
      effectiveFrom: "2024-01-01",
    },
    actorUserId,
  );
}

function createTestShareClass({ database, companyId, actorUserId }: CompanyFixture) {
  return createShareClass(
    database,
    { companyId, name: "A", votesPerShare: "1", effectiveFrom: "2024-01-01" },
    actorUserId,
  );
}

function appendOpeningWithReversal({
  database,
  companyId,
  shareholderId,
  shareClassId,
  actorUserId,
}: CompanyFixture & Readonly<{ shareholderId: string; shareClassId: string }>): void {
  const opening = appendShareEvents(
    database,
    companyId,
    [
      {
        effectiveDate: "2024-01-01",
        type: "OPENING_STATE_IMPORTED",
        payload: {
          holdings: [
            {
              shareholderId,
              shareClassId,
              ranges: [{ from: 1, to: 10 }],
            },
          ],
          sourceType: "SHARE_REGISTER",
          importNote: "Migration and removal integration test",
        },
      },
    ],
    actorUserId,
  ).events[0];
  if (!opening) throw new Error("Expected an opening event");
  database.db
    .insert(shareEvents)
    .values({
      id: randomUUID(),
      companyId,
      sequence: 2,
      schemaVersion: 1,
      effectiveDate: "2024-01-02",
      registeredAt: new Date().toISOString(),
      registeredBy: actorUserId,
      operationId: randomUUID(),
      type: "EVENT_REVERSED",
      payload: { targetEventId: opening.id, explanation: "Self-reference cascade test" },
      reversalTargetId: opening.id,
    })
    .run();
}

function createActiveCompany({ database, actorUserId }: ActorFixture) {
  const company = createCompany(
    database,
    {
      legalName: "Hemligt Testbolag AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556016-0680",
    },
    actorUserId,
  );
  const fixture = { database, companyId: company.id, actorUserId };
  const shareholder = createTestShareholder(fixture);
  const shareClass = createTestShareClass(fixture);
  appendOpeningWithReversal({
    ...fixture,
    shareholderId: shareholder.id,
    shareClassId: shareClass.id,
  });
  return { company, shareholder, shareClass };
}

function expectCompanyRows({
  database,
  companyId,
  count,
}: Readonly<{ database: DatabaseContext; companyId: string; count: 0 | 1 }>): void {
  expect(
    database.db.select().from(companies).where(eq(companies.id, companyId)).all(),
  ).toHaveLength(count);
  expect(
    database.db.select().from(shareholders).where(eq(shareholders.companyId, companyId)).all(),
  ).toHaveLength(count);
  expect(
    database.db.select().from(shareClasses).where(eq(shareClasses.companyId, companyId)).all(),
  ).toHaveLength(count);
  const eventCount = database.db
    .select()
    .from(shareEvents)
    .where(eq(shareEvents.companyId, companyId))
    .all().length;
  if (count === 0) expect(eventCount).toBe(0);
  else expect(eventCount).toBeGreaterThan(0);
  expect(
    database.db
      .select()
      .from(currentShareRanges)
      .where(eq(currentShareRanges.companyId, companyId))
      .all(),
  ).toHaveLength(count);
  expect(
    database.db
      .select()
      .from(currentShareholderDetails)
      .where(eq(currentShareholderDetails.companyId, companyId))
      .all(),
  ).toHaveLength(count);
}

function createLegacyMigrations(directory: string): string {
  const legacyFolder = join(directory, "legacy-drizzle");
  const metaFolder = join(legacyFolder, "meta");
  mkdirSync(metaFolder, { recursive: true });
  copyFileSync(join(migrationsFolder, "0000_initial.sql"), join(legacyFolder, "0000_initial.sql"));
  copyFileSync(
    join(migrationsFolder, "0001_secret_wraith.sql"),
    join(legacyFolder, "0001_secret_wraith.sql"),
  );
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter(({ idx }) => idx < 2);
  writeFileSync(join(metaFolder, "_journal.json"), JSON.stringify(journal));
  return legacyFolder;
}

async function signIn(app: ReturnType<typeof createApp>, email: string): Promise<string> {
  const response = await app.request(`${publicOrigin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: publicOrigin },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function deleteCompany({
  app,
  companyId,
  cookie,
}: Readonly<{
  app: ReturnType<typeof createApp>;
  companyId: string;
  cookie: string;
}>): Promise<Response> {
  return Promise.resolve(
    app.request(`${publicOrigin}/api/companies/${companyId}`, {
      method: "DELETE",
      headers: { cookie, origin: publicOrigin },
    }),
  );
}

type AuthenticatedApp = Readonly<{
  app: ReturnType<typeof createApp>;
  database: DatabaseContext;
  adminUserId: string;
  adminCookie: string;
  userCookie: string;
}>;

async function withAuthenticatedApp<T>(operation: (context: AuthenticatedApp) => Promise<T>) {
  const directory = mkdtempSync(join(tmpdir(), "stam-company-removal-api-"));
  const databasePath = join(directory, "stam.sqlite");
  const database = openDatabase(databasePath);
  try {
    migrateDatabase(database);
    const testEnvironment = environment(databasePath);
    const auth = createAuth(database, testEnvironment);
    const admin = await bootstrapFirstAdmin(auth, database, {
      email: "admin@example.com",
      name: "Administrator",
      password,
    });
    await auth.api.createUser({
      body: { email: "user@example.com", name: "Ordinary User", password },
    });
    const app = createApp(database, auth, testEnvironment);
    return await operation({
      app,
      database,
      adminUserId: admin.user.id,
      adminCookie: await signIn(app, "admin@example.com"),
      userCookie: await signIn(app, "user@example.com"),
    });
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectCustomTriggers(database: DatabaseContext): void {
  const names = database.sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);
  expect(names).toEqual([
    "application_audit_events_immutable_delete",
    "application_audit_events_immutable_update",
    "share_classes_immutable_delete",
    "share_classes_immutable_update",
    "share_events_immutable_delete",
    "share_events_immutable_update",
    "share_events_reversal_company_check",
    "shareholders_immutable_delete",
    "shareholders_immutable_update",
  ]);
}

function expectAuditExists({
  database,
  auditId,
}: Readonly<{ database: DatabaseContext; auditId: string }>): void {
  expect(
    database.db
      .select()
      .from(applicationAuditEvents)
      .where(eq(applicationAuditEvents.id, auditId))
      .get(),
  ).toBeDefined();
}

function expectDirectDeletesBlocked(
  database: DatabaseContext,
  aggregate: ReturnType<typeof createActiveCompany>,
): void {
  expect(() =>
    database.db.delete(shareholders).where(eq(shareholders.id, aggregate.shareholder.id)).run(),
  ).toThrow("shareholders are immutable");
  expect(() =>
    database.db.delete(shareClasses).where(eq(shareClasses.id, aggregate.shareClass.id)).run(),
  ).toThrow("share classes are immutable");
  expect(() =>
    database.db.delete(shareEvents).where(eq(shareEvents.companyId, aggregate.company.id)).run(),
  ).toThrow("share_events are immutable");
}

function createDraftCompany({ database, actorUserId }: ActorFixture) {
  const company = createCompany(
    database,
    {
      legalName: "Utkast AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556036-0793",
    },
    actorUserId,
  );
  createTestShareClass({ database, companyId: company.id, actorUserId });
  return company;
}

function removalAudits(database: DatabaseContext) {
  return database.db
    .select()
    .from(applicationAuditEvents)
    .where(eq(applicationAuditEvents.type, "COMPANY_REMOVED"))
    .all();
}

function expectNoRemovedPersonalData(audits: ReturnType<typeof removalAudits>): void {
  const serializedAudit = JSON.stringify(audits);
  for (const personalValue of [
    "Hemligt Testbolag AB",
    "5560160680",
    "Känslig Aktieägare",
    "8112189876",
    "Privatgatan 1",
  ]) {
    expect(serializedAudit).not.toContain(personalValue);
  }
}

describe("hard company removal", () => {
  test("upgrades populated data without losing rows or custom triggers", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-company-removal-migration-"));
    const database = openDatabase(join(directory, "stam.sqlite"));
    try {
      migrateDatabase(database, createLegacyMigrations(directory));
      const aggregate = createActiveCompany({ database, actorUserId: "legacy-user" });
      const priorAudit = recordAuditEvent(database, {
        type: "EXPORT_GENERATED",
        outcome: "SUCCEEDED",
        actorKind: "USER",
        actorUserId: "legacy-user",
        companyId: aggregate.company.id,
        payload: { format: "TEST" },
      });

      migrateDatabase(database, migrationsFolder);

      expect(getCompany(database, aggregate.company.id)?.status).toBe("ACTIVE");
      expectCompanyRows({ database, companyId: aggregate.company.id, count: 1 });
      expectCustomTriggers(database);
      expectAuditExists({ database, auditId: priorAudit.id });
      expectDirectDeletesBlocked(database, aggregate);

      removeCompany(database, aggregate.company.id, "legacy-admin");
      expectCompanyRows({ database, companyId: aggregate.company.id, count: 0 });
      expect(database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expectAuditExists({ database, auditId: priorAudit.id });
      expect(removalAudits(database)).toContainEqual(
        expect.objectContaining({ payload: {}, companyId: aggregate.company.id }),
      );
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("checks admin authorization before lookup and rolls back a draft removal", async () => {
    await withAuthenticatedApp(async ({ app, database, adminUserId, adminCookie, userCookie }) => {
      const draft = createDraftCompany({ database, actorUserId: adminUserId });
      expect(
        (await deleteCompany({ app, companyId: "missing-company", cookie: userCookie })).status,
      ).toBe(403);
      expect((await deleteCompany({ app, companyId: draft.id, cookie: userCookie })).status).toBe(
        403,
      );
      expect(getCompany(database, draft.id)).toBeDefined();
      expect(
        (await deleteCompany({ app, companyId: "missing-company", cookie: adminCookie })).status,
      ).toBe(404);

      database.sqlite.run(`
        CREATE TRIGGER reject_company_removal_audit
        BEFORE INSERT ON application_audit_events
        WHEN NEW.type = 'COMPANY_REMOVED'
        BEGIN
          SELECT RAISE(ABORT, 'forced audit failure');
        END
      `);
      expect((await deleteCompany({ app, companyId: draft.id, cookie: adminCookie })).status).toBe(
        500,
      );
      expect(getCompany(database, draft.id)).toBeDefined();
      expect(
        database.db.select().from(shareClasses).where(eq(shareClasses.companyId, draft.id)).all(),
      ).toHaveLength(1);
      expect(
        database.db.select().from(shareholders).where(eq(shareholders.companyId, draft.id)).all(),
      ).toHaveLength(0);
      database.sqlite.run("DROP TRIGGER reject_company_removal_audit");

      expect((await deleteCompany({ app, companyId: draft.id, cookie: adminCookie })).status).toBe(
        204,
      );
      expectCompanyRows({ database, companyId: draft.id, count: 0 });
    });
  });

  test("removes an active aggregate while retaining redacted audit history", async () => {
    await withAuthenticatedApp(async ({ app, database, adminUserId, adminCookie }) => {
      const active = createActiveCompany({ database, actorUserId: adminUserId });
      const priorAudit = recordAuditEvent(database, {
        type: "EXPORT_GENERATED",
        outcome: "SUCCEEDED",
        actorKind: "USER",
        actorUserId: adminUserId,
        companyId: active.company.id,
        payload: { format: "TEST" },
      });
      expect(
        (await deleteCompany({ app, companyId: active.company.id, cookie: adminCookie })).status,
      ).toBe(204);
      expectCompanyRows({ database, companyId: active.company.id, count: 0 });
      expect(database.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expectAuditExists({ database, auditId: priorAudit.id });

      const audits = removalAudits(database);
      expect(audits).toEqual([
        expect.objectContaining({
          actorUserId: adminUserId,
          companyId: active.company.id,
          targetKind: "COMPANY",
          targetId: active.company.id,
          payload: {},
        }),
      ]);
      expectNoRemovedPersonalData(audits);
    });
  });
});
