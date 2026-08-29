import { z } from "zod";

export const nonemptyStringSchema = z.string().trim().min(1);
const dateSchema = z.iso.date();
const decimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const positiveIntegerSchema = z.number().int().positive().safe();

export const parserInputSchema = z
  .object({
    detailedRegisterText: nonemptyStringSchema,
    ownerOverviewText: nonemptyStringSchema,
    eventsHtml: nonemptyStringSchema,
  })
  .strict();

export const companySchema = z
  .object({
    legalName: nonemptyStringSchema,
    organizationNumber: nonemptyStringSchema,
    exportDate: dateSchema,
  })
  .strict();

export const previousOwnerSchema = z
  .object({
    identifier: nonemptyStringSchema,
    name: nonemptyStringSchema,
    enteredDate: dateSchema,
  })
  .strict();

const ownerSchema = z
  .object({
    identifier: nonemptyStringSchema,
    name: nonemptyStringSchema,
    address: z.array(nonemptyStringSchema).min(1),
  })
  .strict();

export const detailedPostSchema = z
  .object({
    postNumber: positiveIntegerSchema,
    range: z.object({ from: positiveIntegerSchema, to: positiveIntegerSchema }).strict(),
    count: positiveIntegerSchema,
    shareClass: nonemptyStringSchema,
    votes: decimalSchema,
    enteredDate: dateSchema,
    capitalAmount: decimalSchema,
    quotientValue: decimalSchema,
    owner: ownerSchema,
    previousOwners: z.array(previousOwnerSchema),
  })
  .strict();

export const overviewOwnerSchema = z
  .object({
    identifier: nonemptyStringSchema,
    name: nonemptyStringSchema,
    count: positiveIntegerSchema,
    ownershipPercentage: decimalSchema,
    votes: decimalSchema,
    approximateVotePercentage: decimalSchema,
  })
  .strict();

export const ownerOverviewSchema = z
  .object({
    company: companySchema,
    shareClass: nonemptyStringSchema,
    owners: z.array(overviewOwnerSchema).min(1),
    totalCount: positiveIntegerSchema,
    totalVotes: decimalSchema,
  })
  .strict();

export const eventSchema = z
  .object({
    sourceId: z.string().regex(/^\d+$/),
    date: dateSchema,
    type: nonemptyStringSchema,
    description: nonemptyStringSchema,
  })
  .strict();

const warningSchema = z
  .object({
    code: z.enum(["UNSUPPORTED_EVENT_TYPE", "SOURCE_HISTORY_ORDER"]),
    message: nonemptyStringSchema,
    sourceId: z.string().regex(/^\d+$/).optional(),
    postNumber: positiveIntegerSchema.optional(),
  })
  .strict();

export const analysisSchema = z
  .object({
    totalShares: positiveIntegerSchema,
    totalVotes: decimalSchema,
    shareClass: nonemptyStringSchema,
    checks: z
      .object({
        rangeCounts: z.literal(true),
        nonOverlappingRanges: z.literal(true),
        contiguousRanges: z.literal(true),
        votes: z.literal(true),
        overviewTotals: z.literal(true),
        overviewOwners: z.literal(true),
        oneShareClass: z.literal(true),
      })
      .strict(),
    warnings: z.array(warningSchema),
  })
  .strict();

export const parsedRegisterSchema = z
  .object({
    company: companySchema,
    posts: z.array(detailedPostSchema).min(1),
  })
  .strict();

export const parsedImportSchema = z
  .object({
    company: companySchema,
    posts: z.array(detailedPostSchema).min(1),
    overview: ownerOverviewSchema,
    events: z.array(eventSchema).min(1),
    analysis: analysisSchema,
  })
  .strict();

export type FortnoxParserInput = z.input<typeof parserInputSchema>;
export type FortnoxCompany = z.output<typeof companySchema>;
export type FortnoxDetailedPost = z.output<typeof detailedPostSchema>;
export type FortnoxOwnerOverview = z.output<typeof ownerOverviewSchema>;
export type FortnoxEvent = z.output<typeof eventSchema>;
export type FortnoxImportWarning = z.output<typeof warningSchema>;
export type ParsedFortnoxRegister = z.output<typeof parsedRegisterSchema>;
export type ParsedFortnoxImport = z.output<typeof parsedImportSchema>;

export class FortnoxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FortnoxParseError";
  }
}
