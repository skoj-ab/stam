CREATE TEMP TABLE `__stam_company_identifier_migration` (
  `registration_value` text NOT NULL UNIQUE
);
--> statement-breakpoint
INSERT INTO `__stam_company_identifier_migration` (`registration_value`)
SELECT replace(`registration_value`, '-', '')
FROM `companies`
WHERE `registration_country` = 'SE'
  AND `registration_scheme` = 'ORGANISATIONSNUMMER';
--> statement-breakpoint
DROP TABLE `__stam_company_identifier_migration`;
--> statement-breakpoint
UPDATE `companies`
SET `registration_value` = replace(`registration_value`, '-', '')
WHERE `registration_country` = 'SE'
  AND `registration_scheme` = 'ORGANISATIONSNUMMER'
  AND `registration_value` GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]';
