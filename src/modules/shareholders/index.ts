import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import { shareholders } from "../../db/schema.ts";
import {
  effectiveDateSchema,
  parseShareholder,
  type Shareholder,
  shareholderDetailsSchema,
} from "../../domain/share-register/index.ts";
import {
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPersonalNumber,
} from "../../domain/swedish-identifiers.ts";
import { requireCompany } from "../companies/index.ts";

const nonemptyStringSchema = z.string().trim().min(1);

export const createShareholderInputSchema = z
  .object({
    companyId: nonemptyStringSchema,
    kind: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]),
    identifierCountryCode: z.literal("SE"),
    identifierScheme: z.enum(["PERSONNUMMER", "ORGANISATIONSNUMMER"]),
    identifierValue: nonemptyStringSchema,
    initialDetails: shareholderDetailsSchema,
    effectiveFrom: effectiveDateSchema,
  })
  .strict()
  .superRefine((shareholder, context) => {
    const expectedScheme =
      shareholder.kind === "INDIVIDUAL" ? "PERSONNUMMER" : "ORGANISATIONSNUMMER";
    if (shareholder.identifierScheme !== expectedScheme) {
      context.addIssue({
        code: "custom",
        path: ["identifierScheme"],
        message: "Identifierartypen stämmer inte med typen av aktieägare.",
      });
    }
    const normalized =
      shareholder.identifierScheme === "PERSONNUMMER"
        ? normalizeSwedishPersonalNumber(shareholder.identifierValue)
        : normalizeSwedishOrganizationNumber(shareholder.identifierValue);
    if (!normalized) {
      context.addIssue({
        code: "custom",
        path: ["identifierValue"],
        message:
          shareholder.identifierScheme === "PERSONNUMMER"
            ? "Personnumret har en ogiltig kontrollsiffra."
            : "Organisationsnumret har en ogiltig kontrollsiffra.",
      });
    }
  })
  .transform((shareholder) => ({
    ...shareholder,
    identifierValue:
      shareholder.identifierScheme === "PERSONNUMMER"
        ? (normalizeSwedishPersonalNumber(shareholder.identifierValue) ??
          shareholder.identifierValue)
        : (normalizeSwedishOrganizationNumber(shareholder.identifierValue) ??
          shareholder.identifierValue),
  }));

export type CreateShareholderInput = z.input<typeof createShareholderInputSchema>;

function rowToShareholder(row: typeof shareholders.$inferSelect): Shareholder {
  return parseShareholder(row);
}

export function getShareholder(
  database: DatabaseContext,
  shareholderId: string,
): Shareholder | undefined {
  const row = database.db
    .select()
    .from(shareholders)
    .where(eq(shareholders.id, shareholderId))
    .get();
  return row ? rowToShareholder(row) : undefined;
}

export function listShareholders(
  database: DatabaseContext,
  companyId: string,
): readonly Shareholder[] {
  requireCompany(database, companyId);
  return Object.freeze(
    database.db
      .select()
      .from(shareholders)
      .where(eq(shareholders.companyId, companyId))
      .orderBy(asc(shareholders.registeredAt), asc(shareholders.id))
      .all()
      .map(rowToShareholder),
  );
}

export function createShareholder(
  database: DatabaseContext,
  input: CreateShareholderInput,
  registeredBy: string,
): Shareholder {
  const values = createShareholderInputSchema.parse(input);
  const caller = nonemptyStringSchema.parse(registeredBy);
  requireCompany(database, values.companyId);
  const shareholder = parseShareholder({
    id: randomUUID(),
    ...values,
    registeredAt: new Date().toISOString(),
    registeredBy: caller,
  });

  database.db.insert(shareholders).values(shareholder).run();
  return shareholder;
}
