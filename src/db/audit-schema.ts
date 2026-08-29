import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const applicationAuditEvents = sqliteTable(
  "application_audit_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    occurredAt: text("occurred_at").notNull(),
    type: text("type", {
      enum: [
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
      ],
    }).notNull(),
    outcome: text("outcome", { enum: ["SUCCEEDED", "FAILED"] }).notNull(),
    actorKind: text("actor_kind", { enum: ["USER", "SYSTEM", "ANONYMOUS"] }).notNull(),
    actorUserId: text("actor_user_id"),
    companyId: text("company_id"),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    operationId: text("operation_id").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    uniqueIndex("application_audit_events_id_unique").on(table.id),
    index("application_audit_events_occurred_index").on(table.occurredAt, table.sequence),
    index("application_audit_events_type_index").on(table.type, table.occurredAt),
    index("application_audit_events_actor_index").on(table.actorUserId, table.occurredAt),
    index("application_audit_events_company_index").on(table.companyId, table.occurredAt),
    index("application_audit_events_operation_index").on(table.operationId),
    check("application_audit_events_schema_version_check", sql`${table.schemaVersion} = 1`),
    check(
      "application_audit_events_type_check",
      sql`${table.type} in ('AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_PASSKEY_REGISTERED', 'AUTH_ADMINISTRATION', 'INVITATION_CREATED', 'INVITATION_CONSUMED', 'CONFIGURATION_CHANGED', 'IMPORT_COMMITTED', 'EXPORT_GENERATED', 'COMPANY_REMOVED', 'BACKUP_OPERATION', 'RESTORE_OPERATION')`,
    ),
    check(
      "application_audit_events_outcome_check",
      sql`${table.outcome} in ('SUCCEEDED', 'FAILED')`,
    ),
    check(
      "application_audit_events_actor_kind_check",
      sql`${table.actorKind} in ('USER', 'SYSTEM', 'ANONYMOUS')`,
    ),
    check(
      "application_audit_events_actor_check",
      sql`(${table.actorKind} = 'USER' and ${table.actorUserId} is not null) or (${table.actorKind} <> 'USER' and ${table.actorUserId} is null)`,
    ),
    check("application_audit_events_payload_json_check", sql`json_valid(${table.payload})`),
  ],
);
