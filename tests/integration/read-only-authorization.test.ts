import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { readEnvironment } from "../../src/config/environment.ts";
import { type DatabaseContext, openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import {
  applicationAuditEvents,
  companies,
  invitations,
  shareClasses,
  shareEvents,
  shareholders,
  user,
} from "../../src/db/schema.ts";
import { bootstrapFirstAdmin, createAuth } from "../../src/modules/auth/index.ts";
import { createApp } from "../../src/server/app.ts";

const publicOrigin = "http://localhost:5174";
const password = "correct-horse-battery-staple";
type TestApp = ReturnType<typeof createApp>;
type Credential = Readonly<{ cookie?: string; apiKey?: string }>;
type TestUsers = Readonly<{
  admin: { id: string; cookie: string };
  writer: { id: string; cookie: string };
  readonly: { id: string; cookie: string };
}>;
type RegisterFixture = Readonly<{
  companyId: string;
  aliceId: string;
  bobId: string;
  shareClassId: string;
}>;

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
  operation: (app: TestApp, database: DatabaseContext, auth: ReturnType<typeof createAuth>) => T,
): Promise<Awaited<T>> {
  const directory = mkdtempSync(join(tmpdir(), "stam-readonly-authorization-"));
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

function request(
  app: TestApp,
  path: string,
  options: Credential & { method?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.apiKey) headers.set("x-api-key", options.apiKey);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    headers.set("origin", publicOrigin);
  }
  return Promise.resolve(
    app.request(`${publicOrigin}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
}

async function signIn(app: TestApp, email: string): Promise<string> {
  const response = await request(app, "/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter((value) => value !== undefined)
    .join("; ");
}

async function createTestUsers(
  app: TestApp,
  database: DatabaseContext,
  auth: ReturnType<typeof createAuth>,
): Promise<TestUsers> {
  const admin = (
    await bootstrapFirstAdmin(auth, database, {
      email: "admin@example.com",
      name: "Administrator",
      password,
    })
  ).user;
  const writer = (
    await auth.api.createUser({
      body: { email: "writer@example.com", name: "Writer", password, role: "user" },
    })
  ).user;
  const readonly = (
    await auth.api.createUser({
      body: { email: "readonly@example.com", name: "Read-only User", password, role: "readonly" },
    })
  ).user;
  return {
    admin: { id: admin.id, cookie: await signIn(app, admin.email) },
    writer: { id: writer.id, cookie: await signIn(app, writer.email) },
    readonly: { id: readonly.id, cookie: await signIn(app, readonly.email) },
  };
}

function shareholderInput(name: string, identifierValue: string) {
  return {
    kind: "INDIVIDUAL",
    identifierCountryCode: "SE",
    identifierScheme: "PERSONNUMMER",
    identifierValue,
    initialDetails: {
      legalName: name,
      address: {
        lines: [`${name} street 1`],
        postalCode: "111 11",
        locality: "Stockholm",
        countryCode: "SE",
      },
    },
    effectiveFrom: "2024-01-01",
  };
}

async function seedRegister(app: TestApp, writerCookie: string): Promise<RegisterFixture> {
  const companyResponse = await request(app, "/api/companies", {
    method: "POST",
    cookie: writerCookie,
    body: {
      legalName: "Read Access AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "5500000004",
      initialShareClass: { name: "A", votesPerShare: "1", effectiveFrom: "2024-01-01" },
    },
  });
  expect(companyResponse.status).toBe(201);
  const companyId = ((await companyResponse.json()) as { id: string }).id;
  const aliceResponse = await request(app, `/api/companies/${companyId}/shareholders`, {
    method: "POST",
    cookie: writerCookie,
    body: shareholderInput("Alice Andersson", "811218-2392"),
  });
  const bobResponse = await request(app, `/api/companies/${companyId}/shareholders`, {
    method: "POST",
    cookie: writerCookie,
    body: shareholderInput("Bob Berg", "640807-3416"),
  });
  expect([aliceResponse.status, bobResponse.status]).toEqual([201, 201]);
  const aliceId = ((await aliceResponse.json()) as { id: string }).id;
  const bobId = ((await bobResponse.json()) as { id: string }).id;
  const classesResponse = await request(app, `/api/companies/${companyId}/share-classes`, {
    cookie: writerCookie,
  });
  const shareClassId = ((await classesResponse.json()) as Array<{ id: string }>)[0]?.id ?? "";
  const opening = await request(app, `/api/companies/${companyId}/events`, {
    method: "POST",
    cookie: writerCookie,
    body: [
      {
        effectiveDate: "2024-01-01",
        type: "OPENING_STATE_IMPORTED",
        payload: {
          holdings: [{ shareholderId: aliceId, shareClassId, ranges: [{ from: 1, to: 100 }] }],
          sourceType: "SHARE_REGISTER",
          importNote: "Verified opening register",
        },
      },
    ],
  });
  expect(opening.status).toBe(201);
  return { companyId, aliceId, bobId, shareClassId };
}

function businessState(database: DatabaseContext) {
  return {
    companies: database.db.select().from(companies).all().length,
    shareholders: database.db.select().from(shareholders).all().length,
    shareClasses: database.db.select().from(shareClasses).all().length,
    shareEvents: database.db.select().from(shareEvents).all().length,
    invitations: database.db.select().from(invitations).all().length,
    auditEvents: database.db.select().from(applicationAuditEvents).all().length,
  };
}

async function expectWritesForbidden(
  app: TestApp,
  database: DatabaseContext,
  credential: Credential,
  fixture: RegisterFixture,
): Promise<void> {
  const before = businessState(database);
  const postPaths = [
    "/api/companies",
    "/api/companies/imports/fortnox",
    "/api/companies/imports/ocf",
    `/api/companies/${fixture.companyId}/shareholders`,
    `/api/companies/${fixture.companyId}/shareholders/${fixture.aliceId}/details-changes`,
    `/api/companies/${fixture.companyId}/share-classes`,
    `/api/companies/${fixture.companyId}/events`,
  ];
  for (const path of postPaths) {
    expect((await request(app, path, { ...credential, method: "POST", body: {} })).status).toBe(
      403,
    );
  }
  for (const path of [`/api/companies/${fixture.companyId}`, "/api/admin/users/missing"]) {
    expect((await request(app, path, { ...credential, method: "DELETE" })).status).toBe(403);
  }
  expect((await request(app, "/api/admin/directory", credential)).status).toBe(403);
  expect(
    (
      await request(app, "/api/admin/invitations", {
        ...credential,
        method: "POST",
        body: { email: "blocked@example.com", name: "Blocked User" },
      })
    ).status,
  ).toBe(403);
  expect(businessState(database)).toEqual(before);
}

async function createApiKey(app: TestApp, cookie: string): Promise<string> {
  const response = await request(app, "/api/auth/api-key/create", {
    method: "POST",
    cookie,
    body: { name: "Read-only agent", expiresIn: 365 * 24 * 60 * 60 },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { key: string }).key;
}

describe("read-only authorization", () => {
  test("assigns read-only invitations and preserves the role through acceptance", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createTestUsers(app, database, auth);
      const invitation = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invitee@example.com", name: "Invited User", role: "readonly" },
      });
      expect(invitation.status).toBe(201);
      const result = (await invitation.json()) as { token: string };
      expect(
        database.db.select().from(user).where(eq(user.email, "invitee@example.com")).get()?.role,
      ).toBe("readonly");

      const accepted = await request(app, "/api/auth/invitation/accept-password", {
        method: "POST",
        body: { token: result.token, newPassword: "invited-horse-battery-staple" },
      });
      expect(accepted.status).toBe(200);
      expect(
        database.db.select().from(user).where(eq(user.email, "invitee@example.com")).get()?.role,
      ).toBe("readonly");

      const mismatch = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invitee@example.com", name: "Invited User", role: "user" },
      });
      expect(mismatch.status).toBe(409);
      expect(await mismatch.json()).toMatchObject({ code: "INVITATION_ROLE_MISMATCH" });
      const invalid = await request(app, "/api/admin/invitations", {
        method: "POST",
        cookie: users.admin.cookie,
        body: { email: "invalid@example.com", name: "Invalid Role", role: "admin" },
      });
      expect(invalid.status).toBe(400);
      expect(
        database.db.select().from(user).where(eq(user.email, "invalid@example.com")).get(),
      ).toBeUndefined();
    });
  });

  test("allows read-only sessions to inspect, preview, and export", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createTestUsers(app, database, auth);
      const fixture = await seedRegister(app, users.writer.cookie);
      const credential = { cookie: users.readonly.cookie };
      for (const path of [
        "/api/companies",
        `/api/companies/${fixture.companyId}/shareholders`,
        `/api/companies/${fixture.companyId}/share-classes`,
        `/api/companies/${fixture.companyId}/events`,
        `/api/companies/${fixture.companyId}/snapshot`,
      ]) {
        expect((await request(app, path, credential)).status).toBe(200);
      }
      const preview = await request(app, `/api/companies/${fixture.companyId}/events/preview`, {
        ...credential,
        method: "POST",
        body: [
          {
            effectiveDate: "2024-02-01",
            type: "SHARES_TRANSFERRED",
            payload: {
              transferorId: fixture.aliceId,
              transfereeId: fixture.bobId,
              shareClassId: fixture.shareClassId,
              ranges: [{ from: 1, to: 10 }],
              reason: "SALE",
            },
          },
        ],
      });
      expect(preview.status).toBe(200);
      const html = await request(
        app,
        `/api/companies/${fixture.companyId}/share-register/export/html`,
        credential,
      );
      expect(html.status).toBe(200);
      expect(html.headers.get("content-type")).toContain("text/html");
    });
  });

  test("rejects every read-only session business and administration write", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createTestUsers(app, database, auth);
      const fixture = await seedRegister(app, users.writer.cookie);
      await expectWritesForbidden(app, database, { cookie: users.readonly.cookie }, fixture);
    });
  });

  test("filters read-only API-key docs and applies current owner access", async () => {
    await withTestApp(async (app, database, auth) => {
      const users = await createTestUsers(app, database, auth);
      const fixture = await seedRegister(app, users.writer.cookie);
      const key = await createApiKey(app, users.readonly.cookie);
      await expectWritesForbidden(app, database, { apiKey: key }, fixture);
      const docs = (await (await request(app, "/api/agent", { apiKey: key })).json()) as {
        authentication: { roles: string[] };
        authorization: { readOnly: boolean; canMutateApplicationData: boolean };
        operations: Array<{ method: string; path: string; access: string }>;
      };
      expect(docs.authentication.roles).toEqual(["readonly"]);
      expect(docs.authorization).toMatchObject({ readOnly: true, canMutateApplicationData: false });
      expect(docs.operations).toContainEqual(
        expect.objectContaining({ method: "POST", path: expect.stringContaining("/preview") }),
      );
      expect(docs.operations).not.toContainEqual(
        expect.objectContaining({ method: "POST", path: "/api/companies" }),
      );

      database.db.update(user).set({ role: "user" }).where(eq(user.id, users.readonly.id)).run();
      const promoted = await request(app, "/api/companies", {
        method: "POST",
        apiKey: key,
        body: {
          legalName: "Promoted Agent AB",
          registrationCountry: "SE",
          registrationScheme: "ORGANISATIONSNUMMER",
          registrationValue: "5500000020",
        },
      });
      expect(promoted.status).toBe(201);
      database.db
        .update(user)
        .set({ role: "readonly" })
        .where(eq(user.id, users.readonly.id))
        .run();
      expect(
        (await request(app, "/api/companies", { method: "POST", apiKey: key, body: {} })).status,
      ).toBe(403);
    });
  });
});
