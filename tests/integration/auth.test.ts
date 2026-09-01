import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { readEnvironment } from "../../src/config/environment.ts";
import { type DatabaseContext, openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { account, apikey, invitations, session, user } from "../../src/db/schema.ts";
import { listAuditEvents, recordRuntimeConfiguration } from "../../src/modules/audit/index.ts";
import {
  bootstrapFirstAdmin,
  consumeInvitation,
  createAuth,
  createInvitation,
  DEFAULT_INVITATION_TTL_MS,
  finishPasskeyRegistration,
  hashInvitationToken,
  INVITATION_ERROR_CODES,
  MAX_INVITATION_TTL_MS,
  resolveInvitation,
} from "../../src/modules/auth/index.ts";

const publicOrigin = "http://localhost:5174";
const adminCredentials = {
  email: "admin@example.com",
  name: "Initial Administrator",
  password: "correct-horse-battery-staple",
};

function testEnvironment(databasePath: string) {
  return readEnvironment({
    NODE_ENV: "test",
    PORT: "3100",
    DATABASE_PATH: databasePath,
    PUBLIC_ORIGIN: publicOrigin,
    AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
    WEBAUTHN_RP_ID: "localhost",
  });
}

async function withAuthDatabase<T>(
  operation: (
    database: DatabaseContext,
    auth: ReturnType<typeof createAuth>,
    path: string,
  ) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "stam-auth-integration-"));
  const path = join(directory, "stam.sqlite");
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    return await operation(database, createAuth(database, testEnvironment(path)), path);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectInvitationCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error(`Expected invitation error ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(APIError);
    expect((error as APIError).body?.code).toBe(code);
  }
}

describe("authentication database migration", () => {
  test("contains and applies all Better Auth, API-key, passkey, invitation, and app tables", async () => {
    const sql = await Bun.file(resolve(import.meta.dir, "../../drizzle/0000_initial.sql")).text();
    for (const table of ["user", "session", "account", "verification", "passkey", "invitations"]) {
      expect(sql).toContain(`CREATE TABLE \`${table}\``);
    }
    const apiKeyMigration = await Bun.file(
      resolve(import.meta.dir, "../../drizzle/0004_tired_hellfire_club.sql"),
    ).text();
    expect(apiKeyMigration).toContain("CREATE TABLE `apikey`");

    await withAuthDatabase(async (database) => {
      const tableNames = database.sqlite
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);
      for (const table of [
        "application_audit_events",
        "companies",
        "shareholders",
        "share_classes",
        "share_events",
        "current_share_ranges",
        "current_shareholder_details",
        "user",
        "session",
        "account",
        "verification",
        "passkey",
        "apikey",
        "invitations",
      ]) {
        expect(tableNames).toContain(table);
      }
      expect(
        database.sqlite
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'share_events_immutable_update'",
          )
          .get()?.name,
      ).toBe("share_events_immutable_update");
      expect(
        database.sqlite
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'application_audit_events_immutable_update'",
          )
          .get()?.name,
      ).toBe("application_audit_events_immutable_update");
      expect(database.db.select().from(apikey).all()).toEqual([]);
    });
  });
});

describe("Better Auth configuration", () => {
  test("audits safe runtime configuration only when it changes", async () => {
    await withAuthDatabase(async (database, _auth, path) => {
      const environment = testEnvironment(path);
      expect(recordRuntimeConfiguration(database, environment)?.type).toBe("CONFIGURATION_CHANGED");
      expect(recordRuntimeConfiguration(database, environment)).toBe(undefined);
      expect(
        recordRuntimeConfiguration(database, { ...environment, PORT: environment.PORT + 1 })
          ?.payload,
      ).toMatchObject({ changedKeys: ["port"] });

      const serialized = JSON.stringify(listAuditEvents(database));
      expect(serialized).not.toContain(environment.AUTH_SECRET);
      expect(serialized).not.toContain(environment.DATABASE_PATH);
    });
  });

  test("bootstraps one admin, persists a credential session, and disables public sign-up", async () => {
    await withAuthDatabase(async (database, auth, path) => {
      const created = await bootstrapFirstAdmin(auth, database, {
        ...adminCredentials,
        email: " ADMIN@EXAMPLE.COM ",
      });
      expect(created.user.email).toBe(adminCredentials.email);
      expect(created.user.role).toBe("admin");
      expect(database.db.select().from(user).all()).toHaveLength(1);
      expect(database.db.select().from(account).all()).toHaveLength(1);

      await expect(bootstrapFirstAdmin(auth, database, adminCredentials)).rejects.toThrow(
        "already been completed",
      );

      const signedIn = await auth.api.signInEmail({
        body: {
          email: adminCredentials.email,
          password: adminCredentials.password,
        },
      });
      expect(signedIn.token).toBeString();
      expect(database.db.select().from(session).all()).toHaveLength(1);

      const signUpResponse = await auth.handler(
        new Request(`${publicOrigin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: publicOrigin,
          },
          body: JSON.stringify({
            email: "public@example.com",
            name: "Public User",
            password: "not-allowed-password",
          }),
        }),
      );
      expect(signUpResponse.status).toBe(400);
      expect(await signUpResponse.json()).toMatchObject({
        code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
      });
      expect(database.db.select().from(user).all()).toHaveLength(1);

      database.close();
      const reopened = openDatabase(path);
      try {
        expect(reopened.db.select().from(user).all()).toHaveLength(1);
        expect(reopened.db.select().from(session).all()).toHaveLength(1);
      } finally {
        reopened.close();
      }
    });
  });
});

describe("opaque invitations", () => {
  test("stores only a token hash and resolves and consumes exactly once", async () => {
    await withAuthDatabase(async (database, auth) => {
      const admin = (await bootstrapFirstAdmin(auth, database, adminCredentials)).user;
      const invitee = (
        await auth.api.createUser({
          body: {
            email: "invitee@example.com",
            name: "Invited User",
          },
        })
      ).user;
      const wrongUser = (
        await auth.api.createUser({
          body: {
            email: "wrong@example.com",
            name: "Wrong User",
          },
        })
      ).user;

      const created = createInvitation(database, {
        userId: invitee.id,
        email: " INVITEE@EXAMPLE.COM ",
        name: invitee.name,
        createdBy: admin.id,
      });
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(created.invitation.email).toBe("invitee@example.com");
      expect(created.invitation.expiresAt.getTime() - created.invitation.createdAt.getTime()).toBe(
        DEFAULT_INVITATION_TTL_MS,
      );

      const stored = database.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, created.invitation.id))
        .get();
      expect(stored?.tokenHash).toBe(hashInvitationToken(created.token));
      expect(stored?.tokenHash).not.toContain(created.token);

      expect(resolveInvitation(database, created.token).userId).toBe(invitee.id);
      expectInvitationCode(
        () => consumeInvitation(database, created.token, wrongUser.id),
        INVITATION_ERROR_CODES.userMismatch,
      );
      expect(consumeInvitation(database, created.token, invitee.id).consumedAt).toBeInstanceOf(
        Date,
      );
      expect(listAuditEvents(database).map(({ type }) => type)).toEqual(
        expect.arrayContaining(["INVITATION_CREATED", "INVITATION_CONSUMED"]),
      );
      expect(JSON.stringify(listAuditEvents(database))).not.toContain(created.token);
      expectInvitationCode(
        () => consumeInvitation(database, created.token, invitee.id),
        INVITATION_ERROR_CODES.consumed,
      );
      expectInvitationCode(
        () => resolveInvitation(database, "not-an-invitation"),
        INVITATION_ERROR_CODES.invalid,
      );

      const firstRecovery = createInvitation(database, {
        userId: wrongUser.id,
        email: wrongUser.email,
        name: wrongUser.name,
        createdBy: admin.id,
      });
      const replacement = createInvitation(database, {
        userId: wrongUser.id,
        email: wrongUser.email,
        name: wrongUser.name,
        createdBy: admin.id,
      });
      expectInvitationCode(
        () => resolveInvitation(database, firstRecovery.token),
        INVITATION_ERROR_CODES.revoked,
      );
      expect(resolveInvitation(database, replacement.token).id).toBe(replacement.invitation.id);
    });
  });

  test("rejects expired tokens and lets passkey registration resolve only a valid context", async () => {
    await withAuthDatabase(async (database, auth) => {
      const admin = (await bootstrapFirstAdmin(auth, database, adminCredentials)).user;
      const invitee = (
        await auth.api.createUser({
          body: {
            email: "passkey@example.com",
            name: "Passkey User",
          },
        })
      ).user;
      const expiresAt = new Date(Date.now() + 60_000);
      const expired = createInvitation(database, {
        userId: invitee.id,
        email: invitee.email,
        name: invitee.name,
        createdBy: admin.id,
        expiresAt,
      });
      expectInvitationCode(
        () => resolveInvitation(database, expired.token, new Date(expiresAt.getTime() + 1)),
        INVITATION_ERROR_CODES.expired,
      );

      const valid = createInvitation(database, {
        userId: invitee.id,
        email: invitee.email,
        name: invitee.name,
        createdBy: admin.id,
      });
      const response = await auth.handler(
        new Request(
          `${publicOrigin}/api/auth/passkey/generate-register-options?context=${valid.token}`,
          { headers: { origin: publicOrigin } },
        ),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: {
          name: invitee.email,
          displayName: invitee.name,
        },
      });

      const missingContext = await auth.handler(
        new Request(`${publicOrigin}/api/auth/passkey/generate-register-options`, {
          headers: { origin: publicOrigin },
        }),
      );
      expect(missingContext.status).toBe(400);
      expect(await missingContext.json()).toMatchObject({ code: INVITATION_ERROR_CODES.invalid });
    });
  });

  test("rejects invitation lifetimes longer than 24 hours", async () => {
    await withAuthDatabase(async (database, auth) => {
      const admin = (await bootstrapFirstAdmin(auth, database, adminCredentials)).user;
      const invitee = (
        await auth.api.createUser({
          body: { email: "long-lived@example.com", name: "Long Lived User" },
        })
      ).user;

      expectInvitationCode(
        () =>
          createInvitation(database, {
            userId: invitee.id,
            email: invitee.email,
            name: invitee.name,
            createdBy: admin.id,
            expiresAt: new Date(Date.now() + MAX_INVITATION_TTL_MS + 60_000),
          }),
        "INVALID_INVITATION_EXPIRY",
      );
    });
  });

  test("does not require an invitation when an authenticated user adds a passkey", async () => {
    await withAuthDatabase(async (database, auth) => {
      const admin = (await bootstrapFirstAdmin(auth, database, adminCredentials)).user;

      expect(finishPasskeyRegistration(database, undefined, admin.id)).toEqual({
        userId: admin.id,
      });
    });
  });
});
