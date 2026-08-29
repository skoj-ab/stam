import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import {
  createShareRegisterSnapshot,
  parseShareClass,
  parseShareholder,
  parseShareRegisterEvent,
  type ShareClass,
  type Shareholder,
  type ShareRegisterEvent,
  type ShareRegisterSnapshot,
} from "../../domain/share-register/index.ts";
import {
  normalizeSwedishOrganizationNumber,
  normalizeSwedishPersonalNumber,
} from "../../domain/swedish-identifiers.ts";
import { type Company, createCompany, listCompanies, requireCompany } from "../companies/index.ts";
import { ApplicationConflictError } from "../errors.ts";
import { createShareClass } from "../share-classes/index.ts";
import { appendShareEvents, type ShareEventDraftInput } from "../share-events/index.ts";
import { createShareholder } from "../shareholders/index.ts";
import {
  type FortnoxDetailedPost,
  type FortnoxParserInput,
  type ParsedFortnoxImport,
  parseFortnoxImport,
} from "./parser.ts";

type ExactParts = Readonly<{ coefficient: bigint; scale: number }>;

export type FortnoxImportPlan = Readonly<{
  company: Readonly<{
    legalName: string;
    registrationCountry: "SE";
    registrationScheme: "ORGANISATIONSNUMMER";
    registrationValue: string;
    exportDate: string;
  }>;
  shareClass: Readonly<{
    name: string;
    votesPerShare: string;
    totalShares: number;
    totalVotes: string;
  }>;
  shareCapital: Readonly<{ amount: string; currency: "SEK" }>;
  shareholders: readonly Readonly<{
    key: string;
    kind: "INDIVIDUAL" | "LEGAL_ENTITY";
    identifierCountryCode: "SE";
    identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
    identifierValue: string;
    initialDetails: Shareholder["initialDetails"];
    effectiveFrom: string;
    totalShares: number;
    totalVotes: string;
  }>[];
  holdings: readonly Readonly<{
    shareholderKey: string;
    ranges: readonly Readonly<{ from: number; to: number }>[];
  }>[];
  sourceEvents: readonly Readonly<{
    sourceId: string;
    date: string;
    type: string;
    description: string;
    handling: "RECORDED_AS_SOURCE";
  }>[];
  analysis: ParsedFortnoxImport["analysis"];
}>;

export type FortnoxImportPreview = Readonly<{
  plan: FortnoxImportPlan;
  currentSnapshot: ShareRegisterSnapshot;
}>;

export type FortnoxImportResult = Readonly<{
  plan: FortnoxImportPlan;
  company: Company;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  events: readonly ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
}>;

export class FortnoxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FortnoxImportError";
  }
}

function exactParts(value: string): ExactParts {
  const [integer = "0", fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function formatExact(parts: ExactParts): string {
  if (parts.scale === 0) return parts.coefficient.toString();
  const digits = parts.coefficient.toString().padStart(parts.scale + 1, "0");
  return `${digits.slice(0, -parts.scale)}.${digits.slice(-parts.scale)}`
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function addExact(values: readonly string[]): string {
  const parts = values.map(exactParts);
  const scale = parts.reduce((largest, value) => Math.max(largest, value.scale), 0);
  const coefficient = parts.reduce(
    (total, value) => total + value.coefficient * 10n ** BigInt(scale - value.scale),
    0n,
  );
  return formatExact({ coefficient, scale });
}

function greatestCommonDivisor(values: Readonly<{ left: bigint; right: bigint }>): bigint {
  let a = values.left;
  let b = values.right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function divideExact(input: Readonly<{ value: string; divisor: number }>): string {
  const parts = exactParts(input.value);
  let numerator = parts.coefficient;
  let denominator = 10n ** BigInt(parts.scale) * BigInt(input.divisor);
  const divisorGcd = greatestCommonDivisor({ left: numerator, right: denominator });
  numerator /= divisorGcd;
  denominator /= divisorGcd;

  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) {
    throw new FortnoxImportError("Votes per share cannot be represented as an exact decimal.");
  }

  const scale = Math.max(twos, fives);
  numerator *= 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
  return formatExact({ coefficient: numerator, scale });
}

function parseAddress(lines: readonly string[]): Shareholder["initialDetails"]["address"] {
  const localityLine = lines.at(-1);
  const addressLines = lines.slice(0, -1);
  const match = localityLine?.match(/^(\d{3})\s?(\d{2})\s+(.+)$/);
  if (!match || addressLines.length === 0) {
    throw new FortnoxImportError("A shareholder address has no unambiguous Swedish postal line.");
  }
  return {
    lines: addressLines,
    postalCode: `${match[1]} ${match[2]}`,
    locality: match[3]?.trim() ?? "",
    countryCode: "SE",
  };
}

function classifyIdentifier(identifier: string) {
  const organizationNumber = normalizeSwedishOrganizationNumber(identifier);
  if (organizationNumber && Number(organizationNumber[2]) >= 2) {
    return {
      kind: "LEGAL_ENTITY" as const,
      identifierScheme: "ORGANISATIONSNUMMER" as const,
      identifierValue: organizationNumber,
    };
  }
  const personalNumber = normalizeSwedishPersonalNumber(identifier);
  if (personalNumber && Number(personalNumber[2]) <= 1) {
    return {
      kind: "INDIVIDUAL" as const,
      identifierScheme: "PERSONNUMMER" as const,
      identifierValue: personalNumber,
    };
  }
  throw new FortnoxImportError(`Unsupported or ambiguous Swedish identifier: ${identifier}`);
}

function sameSourceOwner(left: FortnoxDetailedPost, right: FortnoxDetailedPost): boolean {
  return (
    left.owner.name === right.owner.name &&
    left.owner.address.join("\n") === right.owner.address.join("\n")
  );
}

function prepareShareholders(parsed: ParsedFortnoxImport) {
  const overviewByIdentifier = new Map(
    parsed.overview.owners.map((owner) => [owner.identifier, owner]),
  );
  const postsByIdentifier = new Map<string, FortnoxDetailedPost[]>();
  for (const post of parsed.posts) {
    const posts = postsByIdentifier.get(post.owner.identifier) ?? [];
    if (posts[0] && !sameSourceOwner(posts[0], post)) {
      throw new FortnoxImportError(
        `Owner ${post.owner.identifier} has inconsistent source details.`,
      );
    }
    posts.push(post);
    postsByIdentifier.set(post.owner.identifier, posts);
  }

  return [...postsByIdentifier.entries()]
    .map(([sourceIdentifier, posts]) => {
      const firstPost = posts[0] as FortnoxDetailedPost;
      const overview = overviewByIdentifier.get(sourceIdentifier);
      if (!overview)
        throw new FortnoxImportError(`Owner ${sourceIdentifier} is missing from the overview.`);
      const identifier = classifyIdentifier(sourceIdentifier);
      return {
        key: identifier.identifierValue,
        ...identifier,
        identifierCountryCode: "SE" as const,
        initialDetails: {
          legalName: firstPost.owner.name,
          address: parseAddress(firstPost.owner.address),
        },
        effectiveFrom: parsed.company.exportDate,
        totalShares: overview.count,
        totalVotes: overview.votes,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function prepareHoldings(parsed: ParsedFortnoxImport) {
  const grouped = new Map<string, { from: number; to: number }[]>();
  for (const post of parsed.posts) {
    const key = classifyIdentifier(post.owner.identifier).identifierValue;
    const ranges = grouped.get(key) ?? [];
    ranges.push(post.range);
    grouped.set(key, ranges);
  }
  return [...grouped]
    .map(([shareholderKey, ranges]) => ({
      shareholderKey,
      ranges: ranges.sort((left, right) => left.from - right.from),
    }))
    .sort((left, right) => (left.ranges[0]?.from ?? 0) - (right.ranges[0]?.from ?? 0));
}

export function prepareFortnoxImport(input: FortnoxParserInput): FortnoxImportPlan {
  const parsed = parseFortnoxImport(input);
  const registrationValue = normalizeSwedishOrganizationNumber(parsed.company.organizationNumber);
  if (!registrationValue) {
    throw new FortnoxImportError("The company organization number is invalid.");
  }
  return Object.freeze({
    company: {
      legalName: parsed.company.legalName,
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue,
      exportDate: parsed.company.exportDate,
    },
    shareClass: {
      name: parsed.analysis.shareClass,
      votesPerShare: divideExact({
        value: parsed.analysis.totalVotes,
        divisor: parsed.analysis.totalShares,
      }),
      totalShares: parsed.analysis.totalShares,
      totalVotes: parsed.analysis.totalVotes,
    },
    shareCapital: {
      amount: addExact(parsed.posts.map((post) => post.capitalAmount)),
      currency: "SEK",
    },
    shareholders: Object.freeze(prepareShareholders(parsed)),
    holdings: Object.freeze(prepareHoldings(parsed)),
    sourceEvents: Object.freeze(
      [...parsed.events]
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) || Number(left.sourceId) - Number(right.sourceId),
        )
        .map((event) => ({ ...event, handling: "RECORDED_AS_SOURCE" as const })),
    ),
    analysis: parsed.analysis,
  });
}

function assertCompanyDoesNotExist(input: {
  database: DatabaseContext;
  registrationValue: string;
}): void {
  const duplicate = listCompanies(input.database).some(
    (company) =>
      company.registrationCountry === "SE" &&
      company.registrationScheme === "ORGANISATIONSNUMMER" &&
      normalizeSwedishOrganizationNumber(company.registrationValue) === input.registrationValue,
  );
  if (duplicate)
    throw new ApplicationConflictError("Ett bolag med organisationsnumret finns redan.");
}

function eventDrafts(input: {
  plan: FortnoxImportPlan;
  shareholderIds: ReadonlyMap<string, string>;
  shareClassId: string;
}): ShareEventDraftInput {
  const sourceDrafts: ShareEventDraftInput = input.plan.sourceEvents.map((event) => ({
    effectiveDate: event.date,
    type: "SOURCE_ACTIVITY_RECORDED",
    payload: {
      sourceEventId: `fortnox:${event.sourceId}`,
      category: event.type,
      description: event.description,
      data: { source: "FORTNOX", exportDate: input.plan.company.exportDate },
    },
  }));
  const holdings = input.plan.holdings.map((holding) => ({
    shareholderId: input.shareholderIds.get(holding.shareholderKey) as string,
    shareClassId: input.shareClassId,
    ranges: holding.ranges,
  }));
  return [
    ...sourceDrafts,
    {
      effectiveDate: input.plan.company.exportDate,
      type: "SHARE_CAPITAL_CHANGED",
      payload: {
        after: input.plan.shareCapital,
        reason: "OTHER",
        note: "Current capital in Fortnox detailed register export",
      },
    },
    {
      effectiveDate: input.plan.company.exportDate,
      type: "OPENING_STATE_IMPORTED",
      payload: {
        holdings,
        sourceType: "SHARE_REGISTER",
        importNote: `Fortnox export ${input.plan.company.exportDate}`,
      },
    },
  ];
}

function previewCatalog(input: { plan: FortnoxImportPlan; actorUserId: string }) {
  const registeredAt = new Date().toISOString();
  const companyId = "fortnox-import-preview";
  const shareholders = input.plan.shareholders.map((shareholder, index) =>
    parseShareholder({
      id: `fortnox-import-preview-shareholder-${index + 1}`,
      companyId,
      kind: shareholder.kind,
      identifierCountryCode: shareholder.identifierCountryCode,
      identifierScheme: shareholder.identifierScheme,
      identifierValue: shareholder.identifierValue,
      initialDetails: shareholder.initialDetails,
      effectiveFrom: shareholder.effectiveFrom,
      registeredAt,
      registeredBy: input.actorUserId,
    }),
  );
  const shareClass = parseShareClass({
    id: "fortnox-import-preview-share-class",
    companyId,
    name: input.plan.shareClass.name,
    votesPerShare: input.plan.shareClass.votesPerShare,
    effectiveFrom: input.plan.company.exportDate,
    registeredAt,
    registeredBy: input.actorUserId,
  });
  return { companyId, registeredAt, shareholders, shareClass };
}

type FortnoxImportOperation = Readonly<{
  database: DatabaseContext;
  input: FortnoxParserInput;
  actorUserId: string;
}>;

export function previewFortnoxImport(operation: FortnoxImportOperation): FortnoxImportPreview {
  const plan = prepareFortnoxImport(operation.input);
  assertCompanyDoesNotExist({
    database: operation.database,
    registrationValue: plan.company.registrationValue,
  });
  const catalog = previewCatalog({ plan, actorUserId: operation.actorUserId });
  const shareholderIds = new Map(
    plan.shareholders.map((shareholder, index) => [
      shareholder.key,
      catalog.shareholders[index]?.id as string,
    ]),
  );
  const operationId = "fortnox-import-preview-operation";
  const events = eventDrafts({ plan, shareholderIds, shareClassId: catalog.shareClass.id }).map(
    (draft, index) =>
      parseShareRegisterEvent({
        id: `fortnox-import-preview-event-${index + 1}`,
        companyId: catalog.companyId,
        sequence: index + 1,
        schemaVersion: 1,
        effectiveDate: draft.effectiveDate,
        registeredAt: catalog.registeredAt,
        registeredBy: operation.actorUserId,
        operationId,
        type: draft.type,
        payload: draft.payload,
      }),
  );
  return Object.freeze({
    plan,
    currentSnapshot: createShareRegisterSnapshot({
      companyId: catalog.companyId,
      shareholders: catalog.shareholders,
      shareClasses: [catalog.shareClass],
      events,
      effectiveOn: plan.company.exportDate,
    }),
  });
}

function createImportedShareholders(input: {
  database: DatabaseContext;
  companyId: string;
  plan: FortnoxImportPlan;
  actorUserId: string;
}): readonly Shareholder[] {
  return input.plan.shareholders.map((shareholder) =>
    createShareholder(
      input.database,
      {
        companyId: input.companyId,
        kind: shareholder.kind,
        identifierCountryCode: shareholder.identifierCountryCode,
        identifierScheme: shareholder.identifierScheme,
        identifierValue: shareholder.identifierValue,
        initialDetails: {
          ...shareholder.initialDetails,
          address: {
            ...shareholder.initialDetails.address,
            lines: [...shareholder.initialDetails.address.lines],
          },
        },
        effectiveFrom: shareholder.effectiveFrom,
      },
      input.actorUserId,
    ),
  );
}

function persistFortnoxPlan(operation: FortnoxImportOperation, plan: FortnoxImportPlan) {
  assertCompanyDoesNotExist({
    database: operation.database,
    registrationValue: plan.company.registrationValue,
  });
  const company = createCompany(
    operation.database,
    {
      legalName: plan.company.legalName,
      registrationCountry: plan.company.registrationCountry,
      registrationScheme: plan.company.registrationScheme,
      registrationValue: plan.company.registrationValue,
    },
    operation.actorUserId,
  );
  const shareClass = createShareClass(
    operation.database,
    {
      companyId: company.id,
      name: plan.shareClass.name,
      votesPerShare: plan.shareClass.votesPerShare,
      effectiveFrom: plan.company.exportDate,
    },
    operation.actorUserId,
  );
  const createdShareholders = createImportedShareholders({
    database: operation.database,
    companyId: company.id,
    plan,
    actorUserId: operation.actorUserId,
  });
  const shareholderIds = new Map(
    plan.shareholders.map((shareholder, index) => [
      shareholder.key,
      createdShareholders[index]?.id as string,
    ]),
  );
  const result = appendShareEvents(
    operation.database,
    company.id,
    eventDrafts({ plan, shareholderIds, shareClassId: shareClass.id }),
    operation.actorUserId,
    {
      kind: "OPENING_FORTNOX",
      details: {
        exportDate: plan.company.exportDate,
        shareholderCount: plan.shareholders.length,
        shareCount: plan.shareClass.totalShares,
        sourceEventCount: plan.sourceEvents.length,
        warningCodes: plan.analysis.warnings.map((warning) => warning.code),
      },
    },
  );
  return Object.freeze({
    plan,
    company: requireCompany(operation.database, company.id),
    shareholders: Object.freeze(createdShareholders),
    shareClasses: Object.freeze([shareClass]),
    events: result.events,
    currentSnapshot: result.currentSnapshot,
  });
}

export function commitFortnoxImport(operation: FortnoxImportOperation): FortnoxImportResult {
  const plan = prepareFortnoxImport(operation.input);
  return withImmediateTransaction(operation.database.sqlite, () =>
    persistFortnoxPlan(operation, plan),
  );
}
