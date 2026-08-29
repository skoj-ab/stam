CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`registration_country` text NOT NULL,
	`registration_scheme` text NOT NULL,
	`registration_value` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	CONSTRAINT "companies_status_check" CHECK("companies"."status" in ('DRAFT', 'ACTIVE')),
	CONSTRAINT "companies_registration_country_check" CHECK(length("companies"."registration_country") = 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_registration_identifier_unique` ON `companies` (`registration_country`,`registration_scheme`,`registration_value`);--> statement-breakpoint
CREATE TABLE `current_share_ranges` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` text NOT NULL,
	`shareholder_id` text NOT NULL,
	`share_class_id` text NOT NULL,
	`range_from` integer NOT NULL,
	`range_to` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shareholder_id`) REFERENCES `shareholders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`share_class_id`) REFERENCES `share_classes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "current_share_ranges_bounds_check" CHECK("current_share_ranges"."range_from" > 0 and "current_share_ranges"."range_to" >= "current_share_ranges"."range_from" and "current_share_ranges"."range_to" <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `current_share_ranges_company_start_unique` ON `current_share_ranges` (`company_id`,`range_from`);--> statement-breakpoint
CREATE INDEX `current_share_ranges_company_owner_index` ON `current_share_ranges` (`company_id`,`shareholder_id`);--> statement-breakpoint
CREATE TABLE `current_shareholder_details` (
	`shareholder_id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`shareholder_id`) REFERENCES `shareholders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `current_shareholder_details_company_id_index` ON `current_shareholder_details` (`company_id`);--> statement-breakpoint
CREATE TABLE `share_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`votes_per_share` text NOT NULL,
	`effective_from` text NOT NULL,
	`registered_at` text NOT NULL,
	`registered_by` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "share_classes_effective_from_check" CHECK(length("share_classes"."effective_from") = 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_classes_company_name_unique` ON `share_classes` (`company_id`,`name`);--> statement-breakpoint
CREATE INDEX `share_classes_company_id_index` ON `share_classes` (`company_id`);--> statement-breakpoint
CREATE TABLE `share_events` (
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
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversal_target_id`) REFERENCES `share_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "share_events_sequence_check" CHECK("share_events"."sequence" > 0),
	CONSTRAINT "share_events_schema_version_check" CHECK("share_events"."schema_version" = 1),
	CONSTRAINT "share_events_effective_date_check" CHECK(length("share_events"."effective_date") = 10),
	CONSTRAINT "share_events_payload_json_check" CHECK(json_valid("share_events"."payload")),
	CONSTRAINT "share_events_type_check" CHECK("share_events"."type" in ('OPENING_STATE_IMPORTED', 'SHARES_ISSUED', 'SHARES_TRANSFERRED', 'SHARES_CANCELLED', 'SHAREHOLDER_DETAILS_CHANGED', 'EVENT_REVERSED')),
	CONSTRAINT "share_events_reversal_target_check" CHECK(("share_events"."type" = 'EVENT_REVERSED' and "share_events"."reversal_target_id" is not null and "share_events"."reversal_target_id" = json_extract("share_events"."payload", '$.targetEventId')) or ("share_events"."type" <> 'EVENT_REVERSED' and "share_events"."reversal_target_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_company_sequence_unique` ON `share_events` (`company_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_reversal_target_unique` ON `share_events` (`reversal_target_id`);--> statement-breakpoint
CREATE INDEX `share_events_company_effective_index` ON `share_events` (`company_id`,`effective_date`,`sequence`);--> statement-breakpoint
CREATE INDEX `share_events_operation_id_index` ON `share_events` (`operation_id`);--> statement-breakpoint
CREATE TABLE `shareholders` (
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
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "shareholders_kind_check" CHECK("shareholders"."kind" in ('INDIVIDUAL', 'LEGAL_ENTITY')),
	CONSTRAINT "shareholders_identifier_country_check" CHECK("shareholders"."identifier_country_code" = 'SE'),
	CONSTRAINT "shareholders_identifier_scheme_check" CHECK(("shareholders"."kind" = 'INDIVIDUAL' and "shareholders"."identifier_scheme" = 'PERSONNUMMER') or ("shareholders"."kind" = 'LEGAL_ENTITY' and "shareholders"."identifier_scheme" = 'ORGANISATIONSNUMMER')),
	CONSTRAINT "shareholders_identifier_value_check" CHECK(length("shareholders"."identifier_value") = 10 and "shareholders"."identifier_value" not glob '*[^0-9]*'),
	CONSTRAINT "shareholders_effective_from_check" CHECK(length("shareholders"."effective_from") = 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shareholders_company_identifier_unique` ON `shareholders` (`company_id`,`identifier_country_code`,`identifier_scheme`,`identifier_value`);--> statement-breakpoint
CREATE INDEX `shareholders_company_id_index` ON `shareholders` (`company_id`);--> statement-breakpoint
CREATE TABLE `application_audit_events` (
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
	CONSTRAINT "application_audit_events_schema_version_check" CHECK("application_audit_events"."schema_version" = 1),
	CONSTRAINT "application_audit_events_type_check" CHECK("application_audit_events"."type" in ('AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_PASSKEY_REGISTERED', 'AUTH_ADMINISTRATION', 'INVITATION_CREATED', 'INVITATION_CONSUMED', 'CONFIGURATION_CHANGED', 'IMPORT_COMMITTED', 'EXPORT_GENERATED', 'BACKUP_OPERATION', 'RESTORE_OPERATION')),
	CONSTRAINT "application_audit_events_outcome_check" CHECK("application_audit_events"."outcome" in ('SUCCEEDED', 'FAILED')),
	CONSTRAINT "application_audit_events_actor_kind_check" CHECK("application_audit_events"."actor_kind" in ('USER', 'SYSTEM', 'ANONYMOUS')),
	CONSTRAINT "application_audit_events_actor_check" CHECK(("application_audit_events"."actor_kind" = 'USER' and "application_audit_events"."actor_user_id" is not null) or ("application_audit_events"."actor_kind" <> 'USER' and "application_audit_events"."actor_user_id" is null)),
	CONSTRAINT "application_audit_events_payload_json_check" CHECK(json_valid("application_audit_events"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_audit_events_id_unique` ON `application_audit_events` (`id`);--> statement-breakpoint
CREATE INDEX `application_audit_events_occurred_index` ON `application_audit_events` (`occurred_at`,`sequence`);--> statement-breakpoint
CREATE INDEX `application_audit_events_type_index` ON `application_audit_events` (`type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_actor_index` ON `application_audit_events` (`actor_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_company_index` ON `application_audit_events` (`company_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `application_audit_events_operation_index` ON `application_audit_events` (`operation_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_user_id_index` ON `invitations` (`user_id`);--> statement-breakpoint
CREATE INDEX `invitations_email_index` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);--> statement-breakpoint
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_update`
BEFORE UPDATE ON `share_events`
BEGIN
	SELECT RAISE(ABORT, 'share_events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_delete`
BEFORE DELETE ON `share_events`
BEGIN
	SELECT RAISE(ABORT, 'share_events are immutable');
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
CREATE TRIGGER `shareholders_immutable_update`
BEFORE UPDATE ON `shareholders`
BEGIN
	SELECT RAISE(ABORT, 'shareholders are immutable; register a details change event');
END;
--> statement-breakpoint
CREATE TRIGGER `shareholders_immutable_delete`
BEFORE DELETE ON `shareholders`
BEGIN
	SELECT RAISE(ABORT, 'shareholders are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `share_classes_immutable_update`
BEFORE UPDATE ON `share_classes`
BEGIN
	SELECT RAISE(ABORT, 'share classes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `share_classes_immutable_delete`
BEFORE DELETE ON `share_classes`
BEGIN
	SELECT RAISE(ABORT, 'share classes are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `application_audit_events_immutable_update`
BEFORE UPDATE ON `application_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'application audit events are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `application_audit_events_immutable_delete`
BEFORE DELETE ON `application_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'application audit events are immutable');
END;
