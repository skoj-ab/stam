import type { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { DatabaseContext } from "../../db/database.ts";
import { recordAuditEvent } from "../audit/index.ts";
import type { StamAuth } from "./auth.ts";

type ResolvedSession = NonNullable<Awaited<ReturnType<StamAuth["api"]["getSession"]>>>;

export type AuthVariables = {
  authSession: ResolvedSession["session"];
  authUser: ResolvedSession["user"];
  authMethod: "SESSION" | "API_KEY";
  apiKeyId?: string;
};

export function createAuthSessionMiddleware(auth: StamAuth) {
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    const result = await auth.api.getSession({ headers: context.req.raw.headers });
    if (!result) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    if (result.user.banned) {
      return context.json({ error: "User is banned" }, 403);
    }

    const apiKeyAuthenticated = Boolean(context.req.header("x-api-key"));
    context.set("authSession", result.session);
    context.set("authUser", result.user);
    context.set("authMethod", apiKeyAuthenticated ? "API_KEY" : "SESSION");
    if (apiKeyAuthenticated) context.set("apiKeyId", result.session.id);
    await next();
  });
}

const ADMINISTRATION_ROUTES = new Set([
  "/admin/set-role",
  "/admin/create-user",
  "/admin/update-user",
  "/admin/unban-user",
  "/admin/ban-user",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
  "/admin/revoke-user-session",
  "/admin/revoke-user-sessions",
  "/admin/set-user-password",
  "/api-key/create",
  "/api-key/update",
  "/api-key/delete",
]);

function withoutApiKey(request: Request): Request {
  if (!request.headers.has("x-api-key")) return request;
  const sanitized = request.clone();
  sanitized.headers.delete("x-api-key");
  return sanitized;
}

type AuthAudit = Readonly<{
  type: "AUTH_LOGIN" | "AUTH_LOGOUT" | "AUTH_PASSKEY_REGISTERED" | "AUTH_ADMINISTRATION";
  payload: Record<string, unknown>;
}>;

function authAuditForPath(path: string): AuthAudit | undefined {
  if (path === "/sign-in/email") return { type: "AUTH_LOGIN", payload: { method: "PASSWORD" } };
  if (path === "/passkey/verify-authentication") {
    return { type: "AUTH_LOGIN", payload: { method: "PASSKEY" } };
  }
  if (path === "/sign-out") return { type: "AUTH_LOGOUT", payload: {} };
  if (path === "/passkey/verify-registration") {
    return { type: "AUTH_PASSKEY_REGISTERED", payload: {} };
  }
  if (ADMINISTRATION_ROUTES.has(path)) {
    return { type: "AUTH_ADMINISTRATION", payload: { action: path.slice(7).toUpperCase() } };
  }
  return undefined;
}

export function mountAuthRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  auth: StamAuth,
  database: DatabaseContext,
): void {
  app.on(["GET", "POST"], "/api/auth/*", async (context) => {
    const request = withoutApiKey(context.req.raw);
    const path = new URL(context.req.url).pathname.slice("/api/auth".length);
    if (path === "/admin/remove-user") return context.json({ error: "Not found" }, 404);
    const audit = authAuditForPath(path);
    if (!audit) return auth.handler(request);

    const session = await auth.api.getSession({ headers: request.headers });
    const response = await auth.handler(request);
    recordAuditEvent(database, {
      ...audit,
      outcome: response.ok ? "SUCCEEDED" : "FAILED",
      actorKind: session ? "USER" : "ANONYMOUS",
      actorUserId: session?.user.id,
    });
    return response;
  });
}
