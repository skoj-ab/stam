import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import { companies } from "../../db/schema.ts";
import {
  isValidSwedishOrganizationNumber,
  normalizeSwedishOrganizationNumber,
} from "../../domain/swedish-identifiers.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { NotFoundError } from "../errors.ts";

const nonemptyStringSchema = z.string().trim().min(1);

const companyInputSchema = z
  .object({
    legalName: nonemptyStringSchema,
    registrationCountry: z.string().regex(/^[A-Z]{2}$/),
    registrationScheme: nonemptyStringSchema,
    registrationValue: nonemptyStringSchema,
  })
  .strict();

function hasValidRegistrationValue(company: z.output<typeof companyInputSchema>): boolean {
  if (company.registrationCountry !== "SE") return true;
  if (company.registrationScheme !== "ORGANISATIONSNUMMER") return true;
  return isValidSwedishOrganizationNumber(company.registrationValue);
}

export const createCompanyInputSchema = companyInputSchema
  .refine(hasValidRegistrationValue, {
    path: ["registrationValue"],
    message: "Organisationsnumret har en ogiltig kontrollsiffra.",
  })
  .overwrite((company) => {
    if (
      company.registrationCountry !== "SE" ||
      company.registrationScheme !== "ORGANISATIONSNUMMER"
    ) {
      return company;
    }
    return {
      ...company,
      registrationValue:
        normalizeSwedishOrganizationNumber(company.registrationValue) ?? company.registrationValue,
    };
  });

const companySchema = companyInputSchema
  .extend({
    id: z.string().min(1),
    status: z.enum(["DRAFT", "ACTIVE"]),
    createdAt: z.iso.datetime({ offset: false }),
    createdBy: nonemptyStringSchema,
  })
  .strict();

export type CreateCompanyInput = z.input<typeof createCompanyInputSchema>;
export type Company = z.output<typeof companySchema>;

function parseCompany(input: unknown): Company {
  return Object.freeze(companySchema.parse(input));
}

export function getCompany(database: DatabaseContext, companyId: string): Company | undefined {
  const row = database.db.select().from(companies).where(eq(companies.id, companyId)).get();
  return row ? parseCompany(row) : undefined;
}

export function requireCompany(database: DatabaseContext, companyId: string): Company {
  const company = getCompany(database, companyId);
  if (!company) throw new NotFoundError(`Company not found: ${companyId}`);
  return company;
}

export function listCompanies(database: DatabaseContext): readonly Company[] {
  return Object.freeze(
    database.db
      .select()
      .from(companies)
      .orderBy(asc(companies.legalName), asc(companies.id))
      .all()
      .map(parseCompany),
  );
}

export function createCompany(
  database: DatabaseContext,
  input: CreateCompanyInput,
  registeredBy: string,
): Company {
  const values = createCompanyInputSchema.parse(input);
  const caller = nonemptyStringSchema.parse(registeredBy);
  const company = parseCompany({
    id: randomUUID(),
    ...values,
    status: "DRAFT",
    createdAt: new Date().toISOString(),
    createdBy: caller,
  });

  database.db.insert(companies).values(company).run();
  return company;
}

export function removeCompany(
  database: DatabaseContext,
  companyId: string,
  removedBy: string,
): void {
  const id = nonemptyStringSchema.parse(companyId);
  const actorUserId = nonemptyStringSchema.parse(removedBy);
  const remove = () => {
    requireCompany(database, id);
    database.db.delete(companies).where(eq(companies.id, id)).run();
    recordAuditEvent(database, {
      type: "COMPANY_REMOVED",
      outcome: "SUCCEEDED",
      actorKind: "USER",
      actorUserId,
      companyId: id,
      targetKind: "COMPANY",
      targetId: id,
      payload: {},
    });
  };

  if (database.sqlite.inTransaction) {
    remove();
    return;
  }
  withImmediateTransaction(database.sqlite, remove);
}
