import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ShareholderDetails } from "../domain/share-register/index.ts";

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    registrationCountry: text("registration_country").notNull(),
    registrationScheme: text("registration_scheme").notNull(),
    registrationValue: text("registration_value").notNull(),
    status: text("status", { enum: ["DRAFT", "ACTIVE"] })
      .notNull()
      .default("DRAFT"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [
    uniqueIndex("companies_registration_identifier_unique").on(
      table.registrationCountry,
      table.registrationScheme,
      table.registrationValue,
    ),
    check("companies_status_check", sql`${table.status} in ('DRAFT', 'ACTIVE')`),
    check("companies_registration_country_check", sql`length(${table.registrationCountry}) = 2`),
  ],
);

export const shareholders = sqliteTable(
  "shareholders",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["INDIVIDUAL", "LEGAL_ENTITY"] }).notNull(),
    identifierCountryCode: text("identifier_country_code", { enum: ["SE"] }).notNull(),
    identifierScheme: text("identifier_scheme", {
      enum: ["PERSONNUMMER", "ORGANISATIONSNUMMER"],
    }).notNull(),
    identifierValue: text("identifier_value").notNull(),
    initialDetails: text("initial_details", { mode: "json" }).$type<ShareholderDetails>().notNull(),
    effectiveFrom: text("effective_from").notNull(),
    registeredAt: text("registered_at").notNull(),
    registeredBy: text("registered_by").notNull(),
  },
  (table) => [
    uniqueIndex("shareholders_company_identifier_unique").on(
      table.companyId,
      table.identifierCountryCode,
      table.identifierScheme,
      table.identifierValue,
    ),
    index("shareholders_company_id_index").on(table.companyId),
    check("shareholders_kind_check", sql`${table.kind} in ('INDIVIDUAL', 'LEGAL_ENTITY')`),
    check("shareholders_identifier_country_check", sql`${table.identifierCountryCode} = 'SE'`),
    check(
      "shareholders_identifier_scheme_check",
      sql`(${table.kind} = 'INDIVIDUAL' and ${table.identifierScheme} = 'PERSONNUMMER') or (${table.kind} = 'LEGAL_ENTITY' and ${table.identifierScheme} = 'ORGANISATIONSNUMMER')`,
    ),
    check(
      "shareholders_identifier_value_check",
      sql`length(${table.identifierValue}) = 10 and ${table.identifierValue} not glob '*[^0-9]*'`,
    ),
    check("shareholders_effective_from_check", sql`length(${table.effectiveFrom}) = 10`),
  ],
);

export const shareClasses = sqliteTable(
  "share_classes",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    votesPerShare: text("votes_per_share").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    registeredAt: text("registered_at").notNull(),
    registeredBy: text("registered_by").notNull(),
  },
  (table) => [
    uniqueIndex("share_classes_company_name_unique").on(table.companyId, table.name),
    index("share_classes_company_id_index").on(table.companyId),
    check("share_classes_effective_from_check", sql`length(${table.effectiveFrom}) = 10`),
  ],
);

export const shareEvents = sqliteTable(
  "share_events",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    effectiveDate: text("effective_date").notNull(),
    registeredAt: text("registered_at").notNull(),
    registeredBy: text("registered_by").notNull(),
    operationId: text("operation_id").notNull(),
    type: text("type", {
      enum: [
        "OPENING_STATE_IMPORTED",
        "SHARES_ISSUED",
        "SHARES_TRANSFERRED",
        "SHARES_CANCELLED",
        "SHAREHOLDER_DETAILS_CHANGED",
        "SHARE_CAPITAL_CHANGED",
        "SHARES_SPLIT",
        "SHARES_RENUMBERED",
        "SOURCE_ACTIVITY_RECORDED",
        "EVENT_REVERSED",
      ],
    }).notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    reversalTargetId: text("reversal_target_id").references((): AnySQLiteColumn => shareEvents.id, {
      onDelete: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("share_events_company_sequence_unique").on(table.companyId, table.sequence),
    uniqueIndex("share_events_reversal_target_unique").on(table.reversalTargetId),
    index("share_events_company_effective_index").on(
      table.companyId,
      table.effectiveDate,
      table.sequence,
    ),
    index("share_events_operation_id_index").on(table.operationId),
    check("share_events_sequence_check", sql`${table.sequence} > 0`),
    check("share_events_schema_version_check", sql`${table.schemaVersion} = 1`),
    check("share_events_effective_date_check", sql`length(${table.effectiveDate}) = 10`),
    check("share_events_payload_json_check", sql`json_valid(${table.payload})`),
    check(
      "share_events_type_check",
      sql`${table.type} in ('OPENING_STATE_IMPORTED', 'SHARES_ISSUED', 'SHARES_TRANSFERRED', 'SHARES_CANCELLED', 'SHAREHOLDER_DETAILS_CHANGED', 'SHARE_CAPITAL_CHANGED', 'SHARES_SPLIT', 'SHARES_RENUMBERED', 'SOURCE_ACTIVITY_RECORDED', 'EVENT_REVERSED')`,
    ),
    check(
      "share_events_reversal_target_check",
      sql`(${table.type} = 'EVENT_REVERSED' and ${table.reversalTargetId} is not null and ${table.reversalTargetId} = json_extract(${table.payload}, '$.targetEventId')) or (${table.type} <> 'EVENT_REVERSED' and ${table.reversalTargetId} is null)`,
    ),
  ],
);

export const currentShareRanges = sqliteTable(
  "current_share_ranges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    shareholderId: text("shareholder_id")
      .notNull()
      .references(() => shareholders.id, { onDelete: "cascade" }),
    shareClassId: text("share_class_id")
      .notNull()
      .references(() => shareClasses.id, { onDelete: "cascade" }),
    rangeFrom: integer("range_from").notNull(),
    rangeTo: integer("range_to").notNull(),
  },
  (table) => [
    uniqueIndex("current_share_ranges_company_start_unique").on(table.companyId, table.rangeFrom),
    index("current_share_ranges_company_owner_index").on(table.companyId, table.shareholderId),
    check(
      "current_share_ranges_bounds_check",
      sql`${table.rangeFrom} > 0 and ${table.rangeTo} >= ${table.rangeFrom} and ${table.rangeTo} <= 9007199254740991`,
    ),
  ],
);

export const currentShareholderDetails = sqliteTable(
  "current_shareholder_details",
  {
    shareholderId: text("shareholder_id")
      .primaryKey()
      .references(() => shareholders.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    details: text("details", { mode: "json" }).$type<ShareholderDetails>().notNull(),
  },
  (table) => [index("current_shareholder_details_company_id_index").on(table.companyId)],
);
