PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_current_share_ranges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` text NOT NULL,
	`shareholder_id` text NOT NULL,
	`share_class_id` text NOT NULL,
	`range_from` integer NOT NULL,
	`range_to` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shareholder_id`) REFERENCES `shareholders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`share_class_id`) REFERENCES `share_classes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "current_share_ranges_bounds_check" CHECK("__new_current_share_ranges"."range_from" > 0 and "__new_current_share_ranges"."range_to" >= "__new_current_share_ranges"."range_from" and "__new_current_share_ranges"."range_to" <= 9007199254740991)
);
--> statement-breakpoint
INSERT INTO `__new_current_share_ranges`("id", "company_id", "shareholder_id", "share_class_id", "range_from", "range_to") SELECT "id", "company_id", "shareholder_id", "share_class_id", "range_from", "range_to" FROM `current_share_ranges`;--> statement-breakpoint
DROP TABLE `current_share_ranges`;--> statement-breakpoint
ALTER TABLE `__new_current_share_ranges` RENAME TO `current_share_ranges`;--> statement-breakpoint
CREATE UNIQUE INDEX `current_share_ranges_company_start_unique` ON `current_share_ranges` (`company_id`,`range_from`);--> statement-breakpoint
CREATE INDEX `current_share_ranges_company_owner_index` ON `current_share_ranges` (`company_id`,`shareholder_id`);--> statement-breakpoint
CREATE TABLE `__new_share_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`votes_per_share` text NOT NULL,
	`effective_from` text NOT NULL,
	`registered_at` text NOT NULL,
	`registered_by` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "share_classes_effective_from_check" CHECK(length("__new_share_classes"."effective_from") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_share_classes`("id", "company_id", "name", "votes_per_share", "effective_from", "registered_at", "registered_by") SELECT "id", "company_id", "name", "votes_per_share", "effective_from", "registered_at", "registered_by" FROM `share_classes`;--> statement-breakpoint
DROP TABLE `share_classes`;--> statement-breakpoint
ALTER TABLE `__new_share_classes` RENAME TO `share_classes`;--> statement-breakpoint
CREATE UNIQUE INDEX `share_classes_company_name_unique` ON `share_classes` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `share_classes_company_id_index` ON `share_classes` (`company_id`);--> statement-breakpoint
CREATE TABLE `__new_share_events` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`effective_date` text NOT NULL,
	`registered_at` text NOT NULL,
	`registered_by` text NOT NULL,
	`operation_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`reversal_target_id` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reversal_target_id`) REFERENCES `share_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "share_events_sequence_check" CHECK("__new_share_events"."sequence" > 0),
	CONSTRAINT "share_events_schema_version_check" CHECK("__new_share_events"."schema_version" = 1),
	CONSTRAINT "share_events_effective_date_check" CHECK(length("__new_share_events"."effective_date") = 10),
	CONSTRAINT "share_events_payload_json_check" CHECK(json_valid("__new_share_events"."payload")),
	CONSTRAINT "share_events_type_check" CHECK("__new_share_events"."type" in ('OPENING_STATE_IMPORTED', 'SHARES_ISSUED', 'SHARES_TRANSFERRED', 'SHARES_CANCELLED', 'SHAREHOLDER_DETAILS_CHANGED', 'SHARE_CAPITAL_CHANGED', 'SHARES_SPLIT', 'SHARES_RENUMBERED', 'SOURCE_ACTIVITY_RECORDED', 'EVENT_REVERSED')),
	CONSTRAINT "share_events_reversal_target_check" CHECK(("__new_share_events"."type" = 'EVENT_REVERSED' and "__new_share_events"."reversal_target_id" is not null and "__new_share_events"."reversal_target_id" = json_extract("__new_share_events"."payload", '$.targetEventId')) or ("__new_share_events"."type" <> 'EVENT_REVERSED' and "__new_share_events"."reversal_target_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_share_events`("id", "company_id", "sequence", "schema_version", "effective_date", "registered_at", "registered_by", "operation_id", "type", "payload", "reversal_target_id") SELECT "id", "company_id", "sequence", "schema_version", "effective_date", "registered_at", "registered_by", "operation_id", "type", "payload", "reversal_target_id" FROM `share_events`;--> statement-breakpoint
DROP TABLE `share_events`;--> statement-breakpoint
ALTER TABLE `__new_share_events` RENAME TO `share_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_company_sequence_unique` ON `share_events` (`company_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_reversal_target_unique` ON `share_events` (`reversal_target_id`);--> statement-breakpoint
CREATE INDEX `share_events_company_effective_index` ON `share_events` (`company_id`,`effective_date`,`sequence`);--> statement-breakpoint
CREATE INDEX `share_events_operation_id_index` ON `share_events` (`operation_id`);--> statement-breakpoint
CREATE TABLE `__new_shareholders` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`identifier_country_code` text NOT NULL,
	`identifier_scheme` text NOT NULL,
	`identifier_value` text NOT NULL,
	`initial_details` text NOT NULL,
	`effective_from` text NOT NULL,
	`registered_at` text NOT NULL,
	`registered_by` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "shareholders_kind_check" CHECK("__new_shareholders"."kind" in ('INDIVIDUAL', 'LEGAL_ENTITY')),
	CONSTRAINT "shareholders_identifier_country_check" CHECK("__new_shareholders"."identifier_country_code" = 'SE'),
	CONSTRAINT "shareholders_identifier_scheme_check" CHECK(("__new_shareholders"."kind" = 'INDIVIDUAL' and "__new_shareholders"."identifier_scheme" = 'PERSONNUMMER') or ("__new_shareholders"."kind" = 'LEGAL_ENTITY' and "__new_shareholders"."identifier_scheme" = 'ORGANISATIONSNUMMER')),
	CONSTRAINT "shareholders_identifier_value_check" CHECK(length("__new_shareholders"."identifier_value") = 10 and "__new_shareholders"."identifier_value" not glob '*[^0-9]*'),
	CONSTRAINT "shareholders_effective_from_check" CHECK(length("__new_shareholders"."effective_from") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_shareholders`("id", "company_id", "kind", "identifier_country_code", "identifier_scheme", "identifier_value", "initial_details", "effective_from", "registered_at", "registered_by") SELECT "id", "company_id", "kind", "identifier_country_code", "identifier_scheme", "identifier_value", "initial_details", "effective_from", "registered_at", "registered_by" FROM `shareholders`;--> statement-breakpoint
DROP TABLE `shareholders`;--> statement-breakpoint
ALTER TABLE `__new_shareholders` RENAME TO `shareholders`;--> statement-breakpoint
CREATE UNIQUE INDEX `shareholders_company_identifier_unique` ON `shareholders` (`company_id`,`identifier_country_code`,`identifier_scheme`,`identifier_value`);--> statement-breakpoint
CREATE INDEX `shareholders_company_id_index` ON `shareholders` (`company_id`);--> statement-breakpoint
CREATE TABLE `__new_application_audit_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`type` text NOT NULL,
	`outcome` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_user_id` text,
	`company_id` text,
	`target_kind` text,
	`target_id` text,
	`operation_id` text NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT "application_audit_events_schema_version_check" CHECK("__new_application_audit_events"."schema_version" = 1),
	CONSTRAINT "application_audit_events_type_check" CHECK("__new_application_audit_events"."type" in ('AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_PASSKEY_REGISTERED', 'AUTH_ADMINISTRATION', 'INVITATION_CREATED', 'INVITATION_CONSUMED', 'CONFIGURATION_CHANGED', 'IMPORT_COMMITTED', 'EXPORT_GENERATED', 'COMPANY_REMOVED', 'BACKUP_OPERATION', 'RESTORE_OPERATION')),
	CONSTRAINT "application_audit_events_outcome_check" CHECK("__new_application_audit_events"."outcome" in ('SUCCEEDED', 'FAILED')),
	CONSTRAINT "application_audit_events_actor_kind_check" CHECK("__new_application_audit_events"."actor_kind" in ('USER', 'SYSTEM', 'ANONYMOUS')),
	CONSTRAINT "application_audit_events_actor_check" CHECK(("__new_application_audit_events"."actor_kind" = 'USER' and "__new_application_audit_events"."actor_user_id" is not null) or ("__new_application_audit_events"."actor_kind" <> 'USER' and "__new_application_audit_events"."actor_user_id" is null)),
	CONSTRAINT "application_audit_events_payload_json_check" CHECK(json_valid("__new_application_audit_events"."payload"))
);
--> statement-breakpoint
INSERT INTO `__new_application_audit_events`("sequence", "id", "schema_version", "occurred_at", "type", "outcome", "actor_kind", "actor_user_id", "company_id", "target_kind", "target_id", "operation_id", "payload") SELECT "sequence", "id", "schema_version", "occurred_at", "type", "outcome", "actor_kind", "actor_user_id", "company_id", "target_kind", "target_id", "operation_id", "payload" FROM `application_audit_events`;--> statement-breakpoint
DROP TABLE `application_audit_events`;--> statement-breakpoint
ALTER TABLE `__new_application_audit_events` RENAME TO `application_audit_events`;--> statement-breakpoint
CREATE UNIQUE INDEX `application_audit_events_id_unique` ON `application_audit_events` (`id`);--> statement-breakpoint
CREATE INDEX `application_audit_events_occurred_index` ON `application_audit_events` (`occurred_at`,`sequence`);--> statement-breakpoint
CREATE INDEX `application_audit_events_type_index` ON `application_audit_events` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_actor_index` ON `application_audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_company_index` ON `application_audit_events` (`company_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_operation_index` ON `application_audit_events` (`operation_id`);--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_update`
BEFORE UPDATE ON `share_events`
BEGIN
	SELECT RAISE(ABORT, 'share_events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_delete`
BEFORE DELETE ON `share_events`
WHEN EXISTS (SELECT 1 FROM `companies` WHERE `id` = OLD.`company_id`)
BEGIN
	SELECT RAISE(ABORT, 'share_events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `share_events_reversal_company_check`
BEFORE INSERT ON `share_events`
WHEN NEW.`reversal_target_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `share_events`
    WHERE `id` = NEW.`reversal_target_id`
      AND `company_id` = NEW.`company_id`
  )
BEGIN
	SELECT RAISE(ABORT, 'reversal target must belong to the same company');
END;--> statement-breakpoint
CREATE TRIGGER `shareholders_immutable_update`
BEFORE UPDATE ON `shareholders`
BEGIN
	SELECT RAISE(ABORT, 'shareholders are immutable; register a details change event');
END;--> statement-breakpoint
CREATE TRIGGER `shareholders_immutable_delete`
BEFORE DELETE ON `shareholders`
WHEN EXISTS (SELECT 1 FROM `companies` WHERE `id` = OLD.`company_id`)
BEGIN
	SELECT RAISE(ABORT, 'shareholders are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `share_classes_immutable_update`
BEFORE UPDATE ON `share_classes`
BEGIN
	SELECT RAISE(ABORT, 'share classes are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `share_classes_immutable_delete`
BEFORE DELETE ON `share_classes`
WHEN EXISTS (SELECT 1 FROM `companies` WHERE `id` = OLD.`company_id`)
BEGIN
	SELECT RAISE(ABORT, 'share classes are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `application_audit_events_immutable_update`
BEFORE UPDATE ON `application_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'application audit events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `application_audit_events_immutable_delete`
BEFORE DELETE ON `application_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'application audit events are immutable');
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
