PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversal_target_id`) REFERENCES `share_events`(`id`) ON UPDATE no action ON DELETE restrict,
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
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_company_sequence_unique` ON `share_events` (`company_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `share_events_reversal_target_unique` ON `share_events` (`reversal_target_id`);--> statement-breakpoint
CREATE INDEX `share_events_company_effective_index` ON `share_events` (`company_id`,`effective_date`,`sequence`);--> statement-breakpoint
CREATE INDEX `share_events_operation_id_index` ON `share_events` (`operation_id`);--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_update`
BEFORE UPDATE ON `share_events`
BEGIN
	SELECT RAISE(ABORT, 'share_events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `share_events_immutable_delete`
BEFORE DELETE ON `share_events`
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
END;
