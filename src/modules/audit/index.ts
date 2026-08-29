import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Environment } from "../../config/environment.ts";
import type { DatabaseContext } from "../../db/database.ts";
import { applicationAuditEvents } from "../../db/schema.ts";

export const auditEventTypeSchema = z.enum([
  "AUTH_LOGIN",
  "AUTH_LOGOUT",
  "AUTH_PASSKEY_REGISTERED",
  "AUTH_ADMINISTRATION",
  "INVITATION_CREATED",
  "INVITATION_CONSUMED",
  "CONFIGURATION_CHANGED",
  "IMPORT_COMMITTED",
  "EXPORT_GENERATED",
  "COMPANY_REMOVED",
  "BACKUP_OPERATION",
  "RESTORE_OPERATION",
]);

const auditEventInputSchema = z
  .object({
    type: auditEventTypeSchema,
    outcome: z.enum(["SUCCEEDED", "FAILED"]),
    actorKind: z.enum(["USER", "SYSTEM", "ANONYMOUS"]),
    actorUserId: z.string().trim().min(1).optional(),
    companyId: z.string().trim().min(1).optional(),
    targetKind: z.string().trim().min(1).optional(),
    targetId: z.string().trim().min(1).optional(),
    operationId: z.string().trim().min(1).optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.actorKind === "USER" && !event.actorUserId) {
      context.addIssue({
        code: "custom",
        path: ["actorUserId"],
        message: "User audit events require an actor user ID",
      });
    }
    if (event.actorKind !== "USER" && event.actorUserId) {
      context.addIssue({
        code: "custom",
        path: ["actorUserId"],
        message: "Only user audit events may include an actor user ID",
      });
    }
  });

export type AuditEventInput = z.input<typeof auditEventInputSchema>;
export type AuditEvent = typeof applicationAuditEvents.$inferSelect;

const auditedConfigurationSchema = z
  .object({
    nodeEnvironment: z.enum(["development", "test", "production"]),
    port: z.number().int(),
    publicOrigin: z.string(),
    webauthnRpId: z.string(),
  })
  .strict();

type AuditedConfiguration = z.output<typeof auditedConfigurationSchema>;

function auditedConfiguration(environment: Environment): AuditedConfiguration {
  return Object.freeze({
    nodeEnvironment: environment.NODE_ENV,
    port: environment.PORT,
    publicOrigin: environment.PUBLIC_ORIGIN,
    webauthnRpId: environment.WEBAUTHN_RP_ID,
  });
}

function previousConfiguration(database: DatabaseContext): AuditedConfiguration | undefined {
  const latest = database.db
    .select({ payload: applicationAuditEvents.payload })
    .from(applicationAuditEvents)
    .where(eq(applicationAuditEvents.type, "CONFIGURATION_CHANGED"))
    .orderBy(desc(applicationAuditEvents.sequence))
    .limit(1)
    .get();
  const parsed = auditedConfigurationSchema.safeParse(latest?.payload.configuration);
  return parsed.success ? parsed.data : undefined;
}

function changedConfigurationKeys(
  previous: AuditedConfiguration | undefined,
  current: AuditedConfiguration,
): string[] {
  return Object.keys(current).filter(
    (key) =>
      previous?.[key as keyof AuditedConfiguration] !== current[key as keyof AuditedConfiguration],
  );
}

export function recordAuditEvent(database: DatabaseContext, input: AuditEventInput): AuditEvent {
  const event = auditEventInputSchema.parse(input);
  return database.db
    .insert(applicationAuditEvents)
    .values({
      id: randomUUID(),
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      type: event.type,
      outcome: event.outcome,
      actorKind: event.actorKind,
      actorUserId: event.actorUserId ?? null,
      companyId: event.companyId ?? null,
      targetKind: event.targetKind ?? null,
      targetId: event.targetId ?? null,
      operationId: event.operationId ?? randomUUID(),
      payload: event.payload,
    })
    .returning()
    .get();
}

export function listAuditEvents(database: DatabaseContext): readonly AuditEvent[] {
  return Object.freeze(
    database.db
      .select()
      .from(applicationAuditEvents)
      .orderBy(asc(applicationAuditEvents.sequence))
      .all()
      .map((event) => Object.freeze(event)),
  );
}

export function recordRuntimeConfiguration(
  database: DatabaseContext,
  environment: Environment,
): AuditEvent | undefined {
  const configuration = auditedConfiguration(environment);
  const changedKeys = changedConfigurationKeys(previousConfiguration(database), configuration);
  if (changedKeys.length === 0) return undefined;
  return recordAuditEvent(database, {
    type: "CONFIGURATION_CHANGED",
    outcome: "SUCCEEDED",
    actorKind: "SYSTEM",
    payload: { changedKeys, configuration },
  });
}
