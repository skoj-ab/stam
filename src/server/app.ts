import { SQLiteError } from "bun:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, z } from "zod";
import type { Environment } from "../config/environment.ts";
import { type DatabaseContext, withImmediateTransaction } from "../db/database.ts";
import { apikey } from "../db/schema.ts";
import { ShareRegisterError } from "../domain/share-register/index.ts";
import {
  type AuthVariables,
  bootstrapFirstAdmin,
  createAdminInvitation,
  createAuthSessionMiddleware,
  InitialSetupCompletedError,
  initialSetupRequired,
  listAdminDirectory,
  mountAuthRoutes,
  removeUser,
  requireApplicationWrite,
  requireGlobalAdmin,
  type StamAuth,
  userRoles,
} from "../modules/auth/index.ts";
import { adminInvitationInputSchema } from "../modules/auth/invitations.ts";
import {
  createCompany,
  createCompanyInputSchema,
  getCompany,
  listCompanies,
  removeCompany,
} from "../modules/companies/index.ts";
import { ApplicationConflictError, NotFoundError } from "../modules/errors.ts";
import {
  commitFortnoxImport,
  FortnoxImportError,
  FortnoxParseError,
  previewFortnoxImport,
} from "../modules/fortnox-import/index.ts";
import {
  commitOcfImport,
  exportCompanyOcfPackage,
  OcfImportError,
  previewOcfImport,
} from "../modules/ocf/index.ts";
import {
  getCurrentShareRegisterSnapshot,
  getHistoricalShareRegisterSnapshot,
  historicalSnapshotQuerySchema,
} from "../modules/projections/index.ts";
import {
  createShareClass,
  createShareClassInputSchema,
  listShareClasses,
} from "../modules/share-classes/index.ts";
import {
  appendShareEvents,
  previewShareEvents,
  shareEventDraftBatchSchema,
} from "../modules/share-events/index.ts";
import { loadShareRegister } from "../modules/share-register/index.ts";
import {
  createHtmlShareRegisterExport,
  type ShareRegisterExport,
} from "../modules/share-register-exports/index.ts";
import { createPdfShareRegisterExport } from "../modules/share-register-exports/pdf.ts";
import {
  appendMultiCompanyShareholderDetailsChange,
  multiCompanyDetailsChangeInputSchema,
  previewMultiCompanyShareholderDetailsChange,
} from "../modules/shareholder-details/index.ts";
import {
  listShareholderCompanyMatches,
  listShareholderCopyCandidates,
} from "../modules/shareholder-directory/index.ts";
import {
  createShareholder,
  createShareholderInputSchema,
  listShareholders,
} from "../modules/shareholders/index.ts";
import { createAgentApiDocumentation } from "./agent-api-documentation.ts";
import { parseFortnoxImportRequest } from "./fortnox-import-request.ts";

const companyIdParamSchema = z.object({ companyId: z.string().trim().min(1) });
const userIdParamSchema = z.object({ userId: z.string().trim().min(1) });
const requestBodyObjectSchema = z.record(z.string(), z.unknown());
const createCompanyRequestSchema = createCompanyInputSchema.extend({
  initialShareClass: createShareClassInputSchema.omit({ companyId: true }).optional(),
});
const fortnoxImportRequestSchema = z
  .object({
    detailedRegisterText: z.string().trim().min(1),
    ownerOverviewText: z.string().trim().min(1),
    eventsHtml: z.string().trim().min(1),
  })
  .strict();
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
type AppContext = Context<{ Variables: AuthVariables }>;

function exportResponse(context: AppContext, result: ShareRegisterExport): Response {
  context.header("Content-Type", result.contentType);
  context.header("Content-Language", "sv");
  context.header("Content-Disposition", `attachment; filename="${result.filename}"`);
  context.header("Cache-Control", "private, no-store");
  if (typeof result.content === "string") return context.body(result.content);
  const bytes = result.content;
  return context.body(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}

type DetailsChangeOperation = typeof previewMultiCompanyShareholderDetailsChange;

function detailsChangeHandler(
  database: DatabaseContext,
  operation: DetailsChangeOperation,
  status: 200 | 201,
  requiresWrite: boolean,
) {
  return async (context: AppContext) => {
    if (requiresWrite) requireApplicationWrite(database, context.get("authUser").id);
    const result = operation({
      database,
      anchorCompanyId: companyIdFrom(context.req.param()),
      anchorShareholderId: z.string().trim().min(1).parse(context.req.param("shareholderId")),
      input: multiCompanyDetailsChangeInputSchema.parse(await context.req.json()),
      registeredBy: context.get("authUser").id,
    });
    return context.json(result, status);
  };
}

function companyIdFrom(input: Record<string, string>): string {
  return companyIdParamSchema.parse(input).companyId;
}

function withCompanyId(input: unknown, companyId: string): unknown {
  return { ...requestBodyObjectSchema.parse(input), companyId };
}

function isUniqueConstraint(error: SQLiteError): boolean {
  return error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.errno === 2067;
}

function isFortnoxValidationError(error: Error): boolean {
  return error instanceof FortnoxParseError || error instanceof FortnoxImportError;
}

function validationErrorResponse(error: Error, context: AppContext): Response | undefined {
  if (error instanceof ZodError) {
    return context.json({ error: "Invalid request", issues: error.issues }, 400);
  }
  if (error instanceof SyntaxError) return context.json({ error: "Invalid request" }, 400);
  if (error instanceof OcfImportError) {
    return context.json({ error: error.message, report: error.report }, 422);
  }
  if (!isFortnoxValidationError(error)) return undefined;
  return context.json(
    {
      error: "Invalid request",
      issues: [
        {
          code: "custom",
          path: [],
          message: "Fortnox-underlagen kunde inte valideras. Kontrollera filerna och försök igen.",
        },
      ],
    },
    400,
  );
}

function notFoundErrorResponse(error: Error, context: AppContext): Response | undefined {
  if (!(error instanceof NotFoundError)) return undefined;
  return context.json({ error: error.message }, 404);
}

function isConflictError(error: Error): boolean {
  if (error instanceof ShareRegisterError) return true;
  if (error instanceof ApplicationConflictError) return true;
  return error instanceof InitialSetupCompletedError;
}

function conflictErrorResponse(error: Error, context: AppContext): Response | undefined {
  if (!isConflictError(error)) return undefined;
  return context.json(
    {
      error: error.message,
      ...(error instanceof ShareRegisterError ? { code: error.code } : {}),
    },
    409,
  );
}

function mountSetupRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  database: DatabaseContext,
  auth: StamAuth,
  environment: Environment,
): void {
  app.get("/api/setup/status", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ required: initialSetupRequired(database) });
  });
  app.post("/api/setup", async (context) => {
    if (context.req.header("origin") !== new URL(environment.PUBLIC_ORIGIN).origin) {
      return context.json({ error: "Forbidden origin" }, 403);
    }
    const result = await bootstrapFirstAdmin(auth, database, await context.req.json());
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
        },
      },
      201,
    );
  });
}

function authErrorResponse(error: Error, context: AppContext): Response | undefined {
  if (!(error instanceof APIError)) return undefined;
  return context.json(
    error.body ?? { error: error.message },
    error.statusCode as ContentfulStatusCode,
  );
}

function sqliteErrorResponse(error: Error, context: AppContext): Response | undefined {
  if (!(error instanceof SQLiteError) || !isUniqueConstraint(error)) return undefined;
  return context.json({ error: "Resource already exists" }, 409);
}

function installErrorHandler(app: Hono<{ Variables: AuthVariables }>): void {
  app.onError((error, context) => {
    const knownResponse =
      validationErrorResponse(error, context) ??
      notFoundErrorResponse(error, context) ??
      conflictErrorResponse(error, context) ??
      authErrorResponse(error, context) ??
      sqliteErrorResponse(error, context);
    if (knownResponse) return knownResponse;
    console.error("Unhandled request error", error);
    return context.json({ error: "Internal server error" }, 500);
  });
}

function createSameOriginMiddleware(environment: Environment) {
  const expectedOrigin = new URL(environment.PUBLIC_ORIGIN).origin;
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    if (!safeMethods.has(context.req.method) && context.get("authMethod") === "SESSION") {
      const origin = context.req.header("origin");
      if (!origin || origin !== expectedOrigin) {
        return context.json({ error: "Forbidden origin" }, 403);
      }
    }
    await next();
  });
}

function locateWebRoot(): string | undefined {
  const candidates = [
    resolve(import.meta.dir, "../web"),
    resolve(import.meta.dir, "../../dist/web"),
    resolve(process.cwd(), "dist/web"),
  ];
  return candidates.find((candidate) => existsSync(resolve(candidate, "index.html")));
}

function createApplicationApi(
  database: DatabaseContext,
  auth: StamAuth,
  environment: Environment,
): Hono<{ Variables: AuthVariables }> {
  const api = new Hono<{ Variables: AuthVariables }>();
  api.use("*", createAuthSessionMiddleware(auth));
  api.use("*", createSameOriginMiddleware(environment));
  api.use(
    "/companies/imports/fortnox*",
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (context) => context.json({ error: "Payload too large" }, 413),
    }),
  );
  api.use(
    "/companies/imports/ocf*",
    bodyLimit({
      maxSize: 10 * 1024 * 1024,
      onError: (context) => context.json({ error: "Payload too large" }, 413),
    }),
  );

  api.get("/session", (context) =>
    context.json({
      session: {
        id: context.get("authSession").id,
        expiresAt: context.get("authSession").expiresAt,
      },
      user: {
        id: context.get("authUser").id,
        name: context.get("authUser").name,
        email: context.get("authUser").email,
        role: context.get("authUser").role,
      },
    }),
  );

  api.get("/agent", (context) => {
    const authUser = context.get("authUser");
    const method = context.get("authMethod");
    const key =
      method === "API_KEY"
        ? database.db
            .select({
              id: apikey.id,
              name: apikey.name,
              start: apikey.start,
              expiresAt: apikey.expiresAt,
            })
            .from(apikey)
            .where(eq(apikey.id, context.get("apiKeyId") ?? ""))
            .get()
        : undefined;
    if (method === "API_KEY" && !key) {
      throw new APIError("UNAUTHORIZED", { message: "API key is unavailable" });
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(
      createAgentApiDocumentation({
        baseUrl: environment.PUBLIC_ORIGIN,
        userId: authUser.id,
        roles: userRoles(authUser.role),
        authentication:
          method === "API_KEY" && key
            ? {
                method,
                keyId: key.id,
                name: key.name,
                startsWith: key.start,
                expiresAt: key.expiresAt,
              }
            : { method: "SESSION" },
      }),
    );
  });

  api.get("/companies", (context) => context.json(listCompanies(database)));
  api.post("/companies/imports/fortnox/preview", async (context) => {
    const input = await parseFortnoxImportRequest(context.req.raw, (body) =>
      fortnoxImportRequestSchema.parse(body),
    );
    return context.json(
      previewFortnoxImport({ database, input, actorUserId: context.get("authUser").id }),
      200,
    );
  });
  api.post("/companies/imports/fortnox", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    const input = await parseFortnoxImportRequest(context.req.raw, (body) =>
      fortnoxImportRequestSchema.parse(body),
    );
    return context.json(
      commitFortnoxImport({ database, input, actorUserId: context.get("authUser").id }),
      201,
    );
  });
  api.post("/companies/imports/ocf/preview", async (context) => {
    return context.json(previewOcfImport(await context.req.json()), 200);
  });
  api.post("/companies/imports/ocf", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    return context.json(
      commitOcfImport(database, await context.req.json(), context.get("authUser").id),
      201,
    );
  });
  api.post("/companies", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    const { initialShareClass, ...input } = createCompanyRequestSchema.parse(
      await context.req.json(),
    );
    const registeredBy = context.get("authUser").id;
    const company = withImmediateTransaction(database.sqlite, () => {
      const created = createCompany(database, input, registeredBy);
      if (initialShareClass) {
        createShareClass(database, { ...initialShareClass, companyId: created.id }, registeredBy);
      }
      return created;
    });
    return context.json(company, 201);
  });
  api.get("/companies/:companyId", (context) => {
    const companyId = companyIdFrom(context.req.param());
    const company = getCompany(database, companyId);
    if (!company) throw new NotFoundError(`Company not found: ${companyId}`);
    return context.json(company);
  });
  api.delete("/companies/:companyId", (context) => {
    const actorUserId = context.get("authUser").id;
    requireGlobalAdmin(database, actorUserId);
    removeCompany(database, companyIdFrom(context.req.param()), actorUserId);
    return context.body(null, 204);
  });

  api.get("/companies/:companyId/shareholders", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(listShareholders(database, companyId));
  });
  api.get("/companies/:companyId/shareholder-copy-candidates", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(listShareholderCopyCandidates(database, companyId));
  });
  api.get("/companies/:companyId/shareholders/:shareholderId/company-matches", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(
      listShareholderCompanyMatches(database, companyId, context.req.param("shareholderId")),
    );
  });
  api.post(
    "/companies/:companyId/shareholders/:shareholderId/details-changes/preview",
    detailsChangeHandler(database, previewMultiCompanyShareholderDetailsChange, 200, false),
  );
  api.post(
    "/companies/:companyId/shareholders/:shareholderId/details-changes",
    detailsChangeHandler(database, appendMultiCompanyShareholderDetailsChange, 201, true),
  );
  api.post("/companies/:companyId/shareholders", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    const companyId = companyIdFrom(context.req.param());
    const input = createShareholderInputSchema.parse(
      withCompanyId(await context.req.json(), companyId),
    );
    return context.json(createShareholder(database, input, context.get("authUser").id), 201);
  });

  api.get("/companies/:companyId/share-classes", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(listShareClasses(database, companyId));
  });
  api.post("/companies/:companyId/share-classes", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    const companyId = companyIdFrom(context.req.param());
    const input = createShareClassInputSchema.parse(
      withCompanyId(await context.req.json(), companyId),
    );
    return context.json(createShareClass(database, input, context.get("authUser").id), 201);
  });

  api.get("/companies/:companyId/events", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(loadShareRegister(database, companyId).events);
  });
  api.post("/companies/:companyId/events/preview", async (context) => {
    const companyId = companyIdFrom(context.req.param());
    const drafts = shareEventDraftBatchSchema.parse(await context.req.json());
    return context.json(
      previewShareEvents(database, companyId, drafts, context.get("authUser").id),
      200,
    );
  });
  api.post("/companies/:companyId/events", async (context) => {
    requireApplicationWrite(database, context.get("authUser").id);
    const companyId = companyIdFrom(context.req.param());
    const drafts = shareEventDraftBatchSchema.parse(await context.req.json());
    return context.json(
      appendShareEvents(database, companyId, drafts, context.get("authUser").id),
      201,
    );
  });

  api.get("/companies/:companyId/snapshot", (context) => {
    const companyId = companyIdFrom(context.req.param());
    return context.json(getCurrentShareRegisterSnapshot(database, companyId));
  });
  api.get("/companies/:companyId/snapshot/history", (context) => {
    const companyId = companyIdFrom(context.req.param());
    const query = historicalSnapshotQuerySchema.parse(context.req.query());
    return context.json(getHistoricalShareRegisterSnapshot(database, companyId, query));
  });
  api.get("/companies/:companyId/share-register/export/:format", async (context) => {
    const companyId = companyIdFrom({ companyId: context.req.param("companyId") });
    const query = historicalSnapshotQuerySchema.parse(context.req.query());
    const format = z.enum(["html", "pdf"]).parse(context.req.param("format"));
    const actorUserId = context.get("authUser").id;
    const result =
      format === "html"
        ? createHtmlShareRegisterExport(database, companyId, query, actorUserId)
        : await createPdfShareRegisterExport({ database, companyId, query, actorUserId });
    return exportResponse(context, result);
  });
  api.post("/companies/:companyId/share-register/export/ocf", async (context) => {
    const result = exportCompanyOcfPackage(
      database,
      companyIdFrom(context.req.param()),
      await context.req.json(),
      context.get("authUser").id,
    );
    return context.json(result, result.package ? 200 : 422);
  });

  api.post("/admin/invitations", async (context) => {
    const input = adminInvitationInputSchema.parse(await context.req.json());
    const created = await createAdminInvitation(auth, database, input, context.get("authUser").id);
    const acceptanceUrl = new URL("/accept-invitation", environment.PUBLIC_ORIGIN);
    acceptanceUrl.searchParams.set("token", created.token);
    return context.json(
      {
        invitation: created.invitation,
        token: created.token,
        acceptanceUrl: acceptanceUrl.toString(),
      },
      201,
    );
  });
  api.get("/admin/directory", (context) => {
    context.header("Cache-Control", "private, no-store");
    return context.json(listAdminDirectory(database, context.get("authUser").id));
  });
  api.delete("/admin/users/:userId", (context) => {
    const { userId } = userIdParamSchema.parse(context.req.param());
    removeUser(database, userId, context.get("authUser").id);
    return context.body(null, 204);
  });

  api.all("*", (context) => context.json({ error: "Not found" }, 404));
  return api;
}

export function createApp(
  database: DatabaseContext,
  auth: StamAuth,
  environment: Environment,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", secureHeaders());
  app.use("*", logger());
  installErrorHandler(app);

  app.get("/api/health", (context) => {
    database.sqlite.query("SELECT 1").get();
    return context.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  mountSetupRoutes(app, database, auth, environment);
  mountAuthRoutes(app, auth, database);
  app.route("/api", createApplicationApi(database, auth, environment));

  const webRoot = locateWebRoot();
  if (webRoot) {
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.get("*", serveStatic({ root: webRoot, path: "index.html" }));
  }

  return app;
}
