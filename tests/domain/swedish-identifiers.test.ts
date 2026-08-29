import { describe, expect, test } from "bun:test";
import {
  formatCompanyRegistrationIdentifier,
  formatSwedishIdentifier,
  isValidSwedishOrganizationNumber,
  isValidSwedishPersonalNumber,
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPersonalNumber,
} from "../../src/domain/swedish-identifiers.ts";
import { createCompanyInputSchema } from "../../src/modules/companies/index.ts";
import { createShareholderInputSchema } from "../../src/modules/shareholders/index.ts";

describe("Swedish identifiers", () => {
  test("validates personal numbers with ten- and twelve-digit formats", () => {
    expect(isValidSwedishPersonalNumber("811218-9876")).toBe(true);
    expect(isValidSwedishPersonalNumber("811218+9876")).toBe(true);
    expect(isValidSwedishPersonalNumber("19811218-9876")).toBe(true);
    expect(isValidSwedishPersonalNumber("198112189876")).toBe(true);
    expect(isValidSwedishPersonalNumber("811218-9877")).toBe(false);
    expect(isValidSwedishPersonalNumber("811218987")).toBe(false);
  });

  test("validates organization numbers with optional separators", () => {
    expect(isValidSwedishOrganizationNumber("556016-0680")).toBe(true);
    expect(isValidSwedishOrganizationNumber("5560160680")).toBe(true);
    expect(isValidSwedishOrganizationNumber("556016-0681")).toBe(false);
    expect(isValidSwedishOrganizationNumber("556016 0680")).toBe(false);
  });

  test("normalizes equivalent identifier formats for storage", () => {
    expect(normalizeSwedishPersonalNumber("19811218-9876")).toBe("8112189876");
    expect(normalizeSwedishPersonalNumber("811218+9876")).toBe("8112189876");
    expect(normalizeSwedishOrganizationNumber("556016-0680")).toBe("5560160680");
    expect(formatSwedishIdentifier("8112189876")).toBe("811218-9876");
    expect(
      formatCompanyRegistrationIdentifier({
        registrationCountry: "SE",
        registrationScheme: "ORGANISATIONSNUMMER",
        registrationValue: "5560160680",
      }),
    ).toBe("556016-0680");
    expect(
      formatCompanyRegistrationIdentifier({
        registrationCountry: "US",
        registrationScheme: "EIN",
        registrationValue: "1234567890",
      }),
    ).toBe("1234567890");
  });

  test("enforces Luhn checks at company and shareholder write boundaries", () => {
    const company = {
      legalName: "Example AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556016-0680",
    };
    expect(createCompanyInputSchema.safeParse(company).success).toBe(true);
    expect(createCompanyInputSchema.parse(company).registrationValue).toBe("5560160680");
    expect(
      createCompanyInputSchema.parse({ ...company, registrationValue: "5560160680" })
        .registrationValue,
    ).toBe("5560160680");
    expect(
      createCompanyInputSchema.safeParse({ ...company, registrationValue: "556016-0681" }).success,
    ).toBe(false);

    const shareholder = {
      companyId: "company-1",
      kind: "INDIVIDUAL" as const,
      identifierCountryCode: "SE" as const,
      identifierScheme: "PERSONNUMMER" as const,
      identifierValue: "811218-9876",
      initialDetails: {
        legalName: "Alice Andersson",
        address: {
          lines: ["First Street 1"],
          postalCode: "111 11",
          locality: "Stockholm",
          countryCode: "SE",
        },
      },
      effectiveFrom: "2024-01-01",
    };
    expect(createShareholderInputSchema.safeParse(shareholder).success).toBe(true);
    expect(
      createShareholderInputSchema.safeParse({
        ...shareholder,
        identifierValue: "811218-9877",
      }).success,
    ).toBe(false);
    expect(createShareholderInputSchema.parse(shareholder).identifierValue).toBe("8112189876");
    expect(
      createShareholderInputSchema.parse({ ...shareholder, identifierValue: "8112189876" })
        .identifierValue,
    ).toBe("8112189876");
  });
});
