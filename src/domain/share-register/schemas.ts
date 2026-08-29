import { z } from "zod";
import { normalizeRanges } from "./ranges.ts";
import type { ExactDecimal, ShareClass, Shareholder, ShareRegisterDomainEvent } from "./types.ts";

const idSchema = z.string().trim().min(1);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function isUtcTimestamp(value: string): boolean {
  if (!utcTimestampPattern.test(value)) return false;
  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.valueOf()) &&
    timestamp.toISOString().slice(0, 10) === value.slice(0, 10)
  );
}

export const effectiveDateSchema = z.string().refine(isCalendarDate, "Expected YYYY-MM-DD");
export const registeredAtSchema = z.string().refine(isUtcTimestamp, "Expected a UTC timestamp");

export const shareRangeSchema = z
  .object({
    from: z.number().int().safe().positive(),
    to: z.number().int().safe().positive(),
  })
  .strict()
  .refine(({ from, to }) => from <= to, "Range start must not exceed range end");

const rangeCollectionSchema = z
  .array(shareRangeSchema)
  .min(1)
  .superRefine((ranges, context) => {
    const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
    for (let index = 1; index < sorted.length; index += 1) {
      if ((sorted[index]?.from ?? 0) <= (sorted[index - 1]?.to ?? 0)) {
        context.addIssue({ code: "custom", message: "Ranges must not overlap" });
        return;
      }
    }
  })
  .transform(normalizeRanges);

export const exactDecimalSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Expected a non-negative exact decimal")
  .transform((value) => value as ExactDecimal);

export const exactMoneySchema = z
  .object({
    amount: exactDecimalSchema,
    currency: z.string().regex(/^[A-Z]{3}$/, "Expected an ISO 4217 currency code"),
  })
  .strict();

export const exactPriceSchema = exactMoneySchema;

export const shareholderDetailsSchema = z
  .object({
    legalName: idSchema,
    emailAddress: z.string().trim().email().optional(),
    phoneNumber: idSchema.optional(),
    address: z
      .object({
        lines: z.array(idSchema).min(1),
        postalCode: idSchema,
        locality: idSchema,
        countryCode: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict(),
  })
  .strict();

export const shareholderSchema = z
  .object({
    id: idSchema,
    companyId: idSchema,
    kind: z.enum(["INDIVIDUAL", "LEGAL_ENTITY"]),
    identifierCountryCode: z.literal("SE"),
    identifierScheme: z.enum(["PERSONNUMMER", "ORGANISATIONSNUMMER"]),
    identifierValue: z.string().regex(/^\d{10}$/),
    initialDetails: shareholderDetailsSchema,
    effectiveFrom: effectiveDateSchema,
    registeredAt: registeredAtSchema,
    registeredBy: idSchema,
  })
  .strict()
  .superRefine((shareholder, context) => {
    const expectedScheme =
      shareholder.kind === "INDIVIDUAL" ? "PERSONNUMMER" : "ORGANISATIONSNUMMER";
    if (shareholder.identifierScheme !== expectedScheme) {
      context.addIssue({
        code: "custom",
        path: ["identifierScheme"],
        message: "Identifier scheme does not match shareholder kind",
      });
    }
  });

export const shareClassSchema = z
  .object({
    id: idSchema,
    companyId: idSchema,
    name: idSchema,
    votesPerShare: exactDecimalSchema,
    effectiveFrom: effectiveDateSchema,
    registeredAt: registeredAtSchema,
    registeredBy: idSchema,
  })
  .strict();

const metadataShape = {
  id: idSchema,
  companyId: idSchema,
  sequence: z.number().int().safe().positive(),
  schemaVersion: z.literal(1),
  effectiveDate: effectiveDateSchema,
  registeredAt: registeredAtSchema,
  registeredBy: idSchema,
  operationId: idSchema,
};

const openingHoldingSchema = z
  .object({
    shareholderId: idSchema,
    shareClassId: idSchema,
    ranges: rangeCollectionSchema,
  })
  .strict();

const openingStateImportedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("OPENING_STATE_IMPORTED"),
    payload: z
      .object({
        holdings: z.array(openingHoldingSchema),
        sourceType: z.enum(["SHARE_REGISTER", "OCF", "OTHER"]),
        importNote: z.string().trim().min(1),
      })
      .strict()
      .refine((payload) => payload.sourceType === "OCF" || payload.holdings.length > 0, {
        path: ["holdings"],
        message: "Only an OCF transaction-history bootstrap may have no holdings.",
      }),
  })
  .strict();

const sharesIssuedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARES_ISSUED"),
    payload: z
      .object({
        shareholderId: idSchema,
        shareClassId: idSchema,
        ranges: rangeCollectionSchema,
        subscriptionPrice: exactPriceSchema.optional(),
      })
      .strict(),
  })
  .strict();

const sharesTransferredSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARES_TRANSFERRED"),
    payload: z
      .object({
        transferorId: idSchema,
        transfereeId: idSchema,
        shareClassId: idSchema,
        ranges: rangeCollectionSchema,
        reason: z.enum(["SALE", "GIFT", "INHERITANCE", "DIVISION_OF_PROPERTY", "OTHER"]),
        reasonNote: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const sharesCancelledSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARES_CANCELLED"),
    payload: z
      .object({
        shareholderId: idSchema,
        shareClassId: idSchema,
        ranges: rangeCollectionSchema,
        reason: z.enum(["REDEMPTION", "CANCELLATION", "OTHER"]),
        reasonNote: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const shareholderDetailsChangedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHAREHOLDER_DETAILS_CHANGED"),
    payload: z
      .object({
        shareholderId: idSchema,
        before: shareholderDetailsSchema,
        after: shareholderDetailsSchema,
      })
      .strict(),
  })
  .strict();

const shareCapitalChangedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARE_CAPITAL_CHANGED"),
    payload: z
      .object({
        before: exactMoneySchema.optional(),
        after: exactMoneySchema,
        reason: z.enum(["FORMATION", "ISSUE", "BONUS_ISSUE", "REDUCTION", "OTHER"]),
        note: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const sharesSplitSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARES_SPLIT"),
    payload: z
      .object({
        factor: z.number().int().safe().min(2),
        note: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

const sharesRenumberedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SHARES_RENUMBERED"),
    payload: z
      .object({
        holdings: z.array(openingHoldingSchema),
        note: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const sourceActivityRecordedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("SOURCE_ACTIVITY_RECORDED"),
    payload: z
      .object({
        sourceEventId: idSchema,
        category: idSchema,
        description: idSchema,
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

const eventReversedSchema = z
  .object({
    ...metadataShape,
    type: z.literal("EVENT_REVERSED"),
    payload: z
      .object({
        targetEventId: idSchema,
        explanation: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const shareRegisterEventSchema = z.discriminatedUnion("type", [
  openingStateImportedSchema,
  sharesIssuedSchema,
  sharesTransferredSchema,
  sharesCancelledSchema,
  shareholderDetailsChangedSchema,
  shareCapitalChangedSchema,
  sharesSplitSchema,
  sharesRenumberedSchema,
  sourceActivityRecordedSchema,
  eventReversedSchema,
]);

function isUnfrozenObject(value: unknown): value is object {
  if (!value || typeof value !== "object") return false;
  return !Object.isFrozen(value);
}

function deepFreeze<T>(value: T): T {
  if (!isUnfrozenObject(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function parseShareRegisterEvent<T extends ShareRegisterDomainEvent["type"]>(
  input: Readonly<{ type: T }> & Record<string, unknown>,
): Extract<ShareRegisterDomainEvent, { type: T }>;
export function parseShareRegisterEvent(input: unknown): ShareRegisterDomainEvent;
export function parseShareRegisterEvent(input: unknown): ShareRegisterDomainEvent {
  return deepFreeze(shareRegisterEventSchema.parse(input)) as ShareRegisterDomainEvent;
}

export function parseShareholder(input: unknown): Shareholder {
  return deepFreeze(shareholderSchema.parse(input)) as Shareholder;
}

export function parseShareClass(input: unknown): ShareClass {
  return deepFreeze(shareClassSchema.parse(input)) as ShareClass;
}

export function parseShareRegisterEvents(
  inputs: readonly unknown[],
): readonly ShareRegisterDomainEvent[] {
  return Object.freeze(inputs.map(parseShareRegisterEvent));
}

export function parseEffectiveDate(input: unknown): string {
  return effectiveDateSchema.parse(input);
}

export function parseRegisteredAt(input: unknown): string {
  return registeredAtSchema.parse(input);
}
