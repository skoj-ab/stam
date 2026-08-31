import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvironment } from "../../src/config/environment.ts";
import { openDatabase } from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { user } from "../../src/db/schema.ts";
import { listAuditEvents } from "../../src/modules/audit/index.ts";
import { createAuth } from "../../src/modules/auth/index.ts";
import { createApp } from "../../src/server/app.ts";

const publicOrigin = "http://localhost:5174";
const password = "correct-horse-battery-staple";

describe("first-run setup", () => {
  test("allows exactly one same-origin administrator setup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-setup-"));
    const databasePath = join(directory, "stam.sqlite");
    const database = openDatabase(databasePath);
    try {
      migrateDatabase(database);
      const environment = readEnvironment({
        NODE_ENV: "test",
        PORT: "3100",
        DATABASE_PATH: databasePath,
        PUBLIC_ORIGIN: publicOrigin,
        AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
        WEBAUTHN_RP_ID: "localhost",
      });
      const auth = createAuth(database, environment);
      const app = createApp(database, auth, environment);

      const initialStatus = await app.request(`${publicOrigin}/api/setup/status`);
      expect(initialStatus.status).toBe(200);
      expect(initialStatus.headers.get("cache-control")).toBe("no-store");
      expect(await initialStatus.json()).toEqual({ required: true });

      const forbidden = await setupRequest(app, {
        email: "attacker@example.com",
        name: "Attacker",
        origin: "https://attacker.example",
      });
      expect(forbidden.status).toBe(403);

      const attempts = await Promise.all([
        setupRequest(app, { email: "first@example.com", name: "First Administrator" }),
        setupRequest(app, { email: "second@example.com", name: "Second Administrator" }),
      ]);
      expect(attempts.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(database.db.select().from(user).all()).toHaveLength(1);

      const created = attempts.find(({ status }) => status === 201);
      expect(created).toBeDefined();
      const result = (await created?.json()) as { user: { email: string; role: string } };
      expect(result.user.role).toBe("admin");
      const signIn = await app.request(`${publicOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: publicOrigin },
        body: JSON.stringify({ email: result.user.email, password }),
      });
      expect(signIn.status).toBe(200);

      const completedStatus = await app.request(`${publicOrigin}/api/setup/status`);
      expect(await completedStatus.json()).toEqual({ required: false });
      expect(JSON.stringify(listAuditEvents(database))).not.toContain(password);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function setupRequest(
  app: ReturnType<typeof createApp>,
  input: { email: string; name: string; origin?: string },
): Promise<Response> {
  return Promise.resolve(
    app.request(`${publicOrigin}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: input.origin ?? publicOrigin },
      body: JSON.stringify({ email: input.email, name: input.name, password }),
    }),
  );
}
