import { ShareRegisterError } from "./errors.ts";
import {
  canonicalizeHoldings,
  countRanges,
  intersectRanges,
  normalizeRanges,
  rangesContain,
  rangesEqual,
  rangesOverlap,
  subtractRanges,
} from "./ranges.ts";
import {
  parseEffectiveDate,
  parseRegisteredAt,
  parseShareClass,
  parseShareholder,
  parseShareRegisterEvents,
} from "./schemas.ts";
import type {
  EventReversed,
  ExactMoney,
  Holding,
  OpeningStateImported,
  RetiredRange,
  ShareCapitalChanged,
  ShareClass,
  Shareholder,
  ShareholderDetails,
  ShareholderDetailsChanged,
  ShareRange,
  ShareRegisterDomainEvent,
  ShareRegisterInput,
  ShareRegisterSnapshot,
  ShareRegisterState,
  SharesCancelled,
  SharesIssued,
  SharesRenumbered,
  SharesSplit,
  SharesTransferred,
  SourceActivityRecorded,
} from "./types.ts";

type MutableState = {
  companyId: string;
  shareCapital?: ExactMoney;
  holdings: Holding[];
  retiredRanges: RetiredRange[];
  shareholderDetails: Map<string, ShareholderDetails>;
  appliedEventIds: string[];
  reversedEventIds: Set<string>;
  activeOpeningEventId?: string;
  hasOpeningHistory: boolean;
};

type ProjectionContext = {
  shareholders: Map<string, Shareholder>;
  shareClasses: Map<string, ShareClass>;
  eventsById: Map<string, ShareRegisterDomainEvent>;
  orderedEvents: readonly ShareRegisterDomainEvent[];
};

type OpeningReversal = Readonly<{
  eventIndex: number;
  event: EventReversed;
  target: OpeningStateImported;
}>;

type StructuralEvent =
  | ShareCapitalChanged
  | SharesSplit
  | SharesRenumbered
  | SourceActivityRecorded;

function fail(code: string, message: string): never {
  throw new ShareRegisterError(code, message);
}

function assertRule(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) fail(code, message);
}

function compareEvents(left: ShareRegisterDomainEvent, right: ShareRegisterDomainEvent): number {
  return left.effectiveDate.localeCompare(right.effectiveDate) || left.sequence - right.sequence;
}

function detailsEqual(left: ShareholderDetails, right: ShareholderDetails): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function moneyEqual(left: ExactMoney, right: ExactMoney): boolean {
  return left.amount === right.amount && left.currency === right.currency;
}

function eventRanges(event: OpeningStateImported): ShareRange[] {
  return normalizeRanges(event.payload.holdings.flatMap((holding) => holding.ranges));
}

function activeRanges(state: MutableState): ShareRange[] {
  return state.holdings.map(({ range }) => range);
}

function ownerRanges(
  state: MutableState,
  shareholderId: string,
  shareClassId: string,
): ShareRange[] {
  return state.holdings
    .filter(
      (holding) => holding.shareholderId === shareholderId && holding.shareClassId === shareClassId,
    )
    .map(({ range }) => range);
}

function assertNoOverlap(ranges: readonly ShareRange[], code: string): void {
  const sorted = [...ranges].sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < sorted.length; index += 1) {
    assertRule(
      !rangesOverlap(sorted[index - 1] as ShareRange, sorted[index] as ShareRange),
      code,
      "Share ranges overlap",
    );
  }
}

function assertShareholder(
  context: ProjectionContext,
  shareholderId: string,
  effectiveDate: string,
): void {
  const shareholder = context.shareholders.get(shareholderId);
  assertRule(shareholder, "UNKNOWN_SHAREHOLDER", `Unknown shareholder: ${shareholderId}`);
  assertRule(
    shareholder.effectiveFrom <= effectiveDate,
    "SHAREHOLDER_NOT_EFFECTIVE",
    `Shareholder ${shareholderId} is not effective on ${effectiveDate}`,
  );
}

function assertShareClass(
  context: ProjectionContext,
  shareClassId: string,
  effectiveDate: string,
): void {
  const shareClass = context.shareClasses.get(shareClassId);
  assertRule(shareClass, "UNKNOWN_SHARE_CLASS", `Unknown share class: ${shareClassId}`);
  assertRule(
    shareClass.effectiveFrom <= effectiveDate,
    "SHARE_CLASS_NOT_EFFECTIVE",
    `Share class ${shareClassId} is not effective on ${effectiveDate}`,
  );
}

function assertOwnership(
  state: MutableState,
  shareholderId: string,
  shareClassId: string,
  ranges: readonly ShareRange[],
): void {
  assertRule(
    rangesContain(ownerRanges(state, shareholderId, shareClassId), ranges),
    "INVALID_OWNERSHIP",
    `Shares are not owned by ${shareholderId} in class ${shareClassId}`,
  );
}

function removeHoldings(
  state: MutableState,
  shareholderId: string,
  shareClassId: string,
  ranges: readonly ShareRange[],
): void {
  const remaining: Holding[] = [];
  for (const holding of state.holdings) {
    if (holding.shareholderId !== shareholderId || holding.shareClassId !== shareClassId) {
      remaining.push(holding);
      continue;
    }
    for (const range of subtractRanges([holding.range], ranges)) {
      remaining.push({ ...holding, range });
    }
  }
  state.holdings = canonicalizeHoldings(remaining);
}

function addHoldings(
  state: MutableState,
  shareholderId: string,
  shareClassId: string,
  ranges: readonly ShareRange[],
): void {
  state.holdings = canonicalizeHoldings([
    ...state.holdings,
    ...ranges.map((range) => ({ shareholderId, shareClassId, range })),
  ]);
}

function transferHoldings(
  state: MutableState,
  transferorId: string,
  transfereeId: string,
  shareClassId: string,
  ranges: readonly ShareRange[],
): void {
  assertOwnership(state, transferorId, shareClassId, ranges);
  removeHoldings(state, transferorId, shareClassId, ranges);
  addHoldings(state, transfereeId, shareClassId, ranges);
}

function matchingReusableRanges(state: MutableState, operationId: string): RetiredRange[] {
  return state.retiredRanges.filter(
    (retired) => retired.reusable && retired.operationId === operationId,
  );
}

function consumeCorrectionRelease(
  state: MutableState,
  operationId: string,
  ranges: readonly ShareRange[],
): boolean {
  const overlappingRetired = state.retiredRanges.filter((retired) =>
    ranges.some((range) => rangesOverlap(range, retired.range)),
  );
  if (overlappingRetired.length === 0) return false;

  const reusable = matchingReusableRanges(state, operationId);
  assertRule(
    reusable.length > 0 &&
      rangesEqual(
        ranges,
        reusable.map(({ range }) => range),
      ),
    "RETIRED_NUMBERS",
    "Retired share numbers may only be reused as an exact correction replacement",
  );
  assertRule(
    overlappingRetired.every((retired) => reusable.includes(retired)),
    "RETIRED_NUMBERS",
    "Ordinarily retired share numbers cannot be reused",
  );
  state.retiredRanges = state.retiredRanges.filter((retired) => !reusable.includes(retired));
  return true;
}

function assertNumbersAvailable(
  state: MutableState,
  operationId: string,
  ranges: readonly ShareRange[],
): void {
  assertRule(
    intersectRanges(activeRanges(state), ranges).length === 0,
    "ACTIVE_NUMBER_OVERLAP",
    "Share numbers overlap active shares",
  );
  consumeCorrectionRelease(state, operationId, ranges);
}

function applyOpening(
  state: MutableState,
  context: ProjectionContext,
  event: OpeningStateImported,
): void {
  assertRule(!state.activeOpeningEventId, "DUPLICATE_OPENING", "An opening state already exists");
  assertRule(
    state.holdings.length === 0,
    "OPENING_NOT_EMPTY",
    "Opening state requires no active shares",
  );

  const ranges = eventRanges(event);
  assertNoOverlap(
    event.payload.holdings.flatMap((holding) => holding.ranges),
    "OPENING_OVERLAP",
  );
  if (state.hasOpeningHistory) {
    assertRule(
      matchingReusableRanges(state, event.operationId).some(
        (retired) =>
          retired.targetEventId &&
          context.eventsById.get(retired.targetEventId)?.type === "OPENING_STATE_IMPORTED",
      ),
      "DUPLICATE_OPENING",
      "A later opening must replace a reversed opening atomically",
    );
  }
  assertNumbersAvailable(state, event.operationId, ranges);

  for (const holding of event.payload.holdings) {
    assertShareholder(context, holding.shareholderId, event.effectiveDate);
    assertShareClass(context, holding.shareClassId, event.effectiveDate);
    addHoldings(state, holding.shareholderId, holding.shareClassId, holding.ranges);
  }
  state.activeOpeningEventId = event.id;
  state.hasOpeningHistory = true;
}

function requireOpening(state: MutableState): void {
  assertRule(state.activeOpeningEventId, "MISSING_OPENING", "An opening state is required first");
}

function applyIssuance(state: MutableState, context: ProjectionContext, event: SharesIssued): void {
  requireOpening(state);
  assertShareholder(context, event.payload.shareholderId, event.effectiveDate);
  assertShareClass(context, event.payload.shareClassId, event.effectiveDate);
  assertNumbersAvailable(state, event.operationId, event.payload.ranges);
  addHoldings(state, event.payload.shareholderId, event.payload.shareClassId, event.payload.ranges);
}

function applyTransfer(
  state: MutableState,
  context: ProjectionContext,
  event: SharesTransferred,
): void {
  requireOpening(state);
  assertRule(
    event.payload.transferorId !== event.payload.transfereeId,
    "SAME_OWNER_TRANSFER",
    "Transferor and transferee must differ",
  );
  assertShareholder(context, event.payload.transferorId, event.effectiveDate);
  assertShareholder(context, event.payload.transfereeId, event.effectiveDate);
  assertShareClass(context, event.payload.shareClassId, event.effectiveDate);
  transferHoldings(
    state,
    event.payload.transferorId,
    event.payload.transfereeId,
    event.payload.shareClassId,
    event.payload.ranges,
  );
}

function applyCancellation(
  state: MutableState,
  context: ProjectionContext,
  event: SharesCancelled,
): void {
  requireOpening(state);
  assertShareholder(context, event.payload.shareholderId, event.effectiveDate);
  assertShareClass(context, event.payload.shareClassId, event.effectiveDate);
  assertOwnership(
    state,
    event.payload.shareholderId,
    event.payload.shareClassId,
    event.payload.ranges,
  );
  removeHoldings(
    state,
    event.payload.shareholderId,
    event.payload.shareClassId,
    event.payload.ranges,
  );
  state.retiredRanges.push(
    ...event.payload.ranges.map((range) => ({
      range,
      source: "CANCELLATION" as const,
      sourceEventId: event.id,
      operationId: event.operationId,
      reusable: false,
    })),
  );
}

function applyDetailsChange(
  state: MutableState,
  context: ProjectionContext,
  event: ShareholderDetailsChanged,
): void {
  assertShareholder(context, event.payload.shareholderId, event.effectiveDate);
  const current = state.shareholderDetails.get(event.payload.shareholderId);
  assertRule(
    current && detailsEqual(current, event.payload.before),
    "DETAILS_BEFORE_MISMATCH",
    "Shareholder details do not match the event's before snapshot",
  );
  state.shareholderDetails.set(event.payload.shareholderId, event.payload.after);
}

function applyCapitalChange(state: MutableState, event: ShareCapitalChanged): void {
  if (event.payload.before) {
    assertRule(
      state.shareCapital && moneyEqual(state.shareCapital, event.payload.before),
      "SHARE_CAPITAL_BEFORE_MISMATCH",
      "Share capital does not match the event's before amount",
    );
  }
  state.shareCapital = event.payload.after;
}

function splitRange(range: ShareRange, factor: number): ShareRange {
  const from = (range.from - 1) * factor + 1;
  const to = range.to * factor;
  assertRule(
    Number.isSafeInteger(from) && Number.isSafeInteger(to),
    "SHARE_SPLIT_OVERFLOW",
    "Share split produces numbers outside the safe integer range",
  );
  return { from, to };
}

function applySplit(state: MutableState, event: SharesSplit): void {
  requireOpening(state);
  state.holdings = canonicalizeHoldings(
    state.holdings.map((holding) => ({
      ...holding,
      range: splitRange(holding.range, event.payload.factor),
    })),
  );
  state.retiredRanges = state.retiredRanges.map((retired) => ({
    ...retired,
    range: splitRange(retired.range, event.payload.factor),
  }));
}

function holdingCountKey(shareholderId: string, shareClassId: string): string {
  return JSON.stringify([shareholderId, shareClassId]);
}

function currentHoldingCounts(holdings: readonly Holding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const holding of holdings) {
    const key = holdingCountKey(holding.shareholderId, holding.shareClassId);
    counts.set(key, (counts.get(key) ?? 0) + countRanges([holding.range]));
  }
  return counts;
}

function replacementHoldingCounts(event: SharesRenumbered): Map<string, number> {
  const counts = new Map<string, number>();
  for (const holding of event.payload.holdings) {
    const key = holdingCountKey(holding.shareholderId, holding.shareClassId);
    counts.set(key, (counts.get(key) ?? 0) + countRanges(holding.ranges));
  }
  return counts;
}

function assertHoldingCountsConserved(state: MutableState, event: SharesRenumbered): void {
  const before = currentHoldingCounts(state.holdings);
  const after = replacementHoldingCounts(event);
  const keys = new Set([...before.keys(), ...after.keys()]);
  assertRule(
    [...keys].every((key) => before.get(key) === after.get(key)),
    "RENUMBERING_COUNT_MISMATCH",
    "Renumbering must conserve the exact share count for each shareholder and class",
  );
}

function applyRenumbering(
  state: MutableState,
  context: ProjectionContext,
  event: SharesRenumbered,
): void {
  requireOpening(state);
  const ranges = event.payload.holdings.flatMap((holding) => holding.ranges);
  assertNoOverlap(ranges, "RENUMBERING_OVERLAP");
  for (const holding of event.payload.holdings) {
    assertShareholder(context, holding.shareholderId, event.effectiveDate);
    assertShareClass(context, holding.shareClassId, event.effectiveDate);
  }
  assertHoldingCountsConserved(state, event);
  state.holdings = canonicalizeHoldings(
    event.payload.holdings.flatMap((holding) =>
      holding.ranges.map((range) => ({
        shareholderId: holding.shareholderId,
        shareClassId: holding.shareClassId,
        range,
      })),
    ),
  );
  state.retiredRanges = [];
}

function isStructuralEvent(event: ShareRegisterDomainEvent): event is StructuralEvent {
  return (
    event.type === "SHARE_CAPITAL_CHANGED" ||
    event.type === "SHARES_SPLIT" ||
    event.type === "SHARES_RENUMBERED" ||
    event.type === "SOURCE_ACTIVITY_RECORDED"
  );
}

function applyStructuralEvent(
  state: MutableState,
  context: ProjectionContext,
  event: StructuralEvent,
): void {
  switch (event.type) {
    case "SHARE_CAPITAL_CHANGED":
      applyCapitalChange(state, event);
      break;
    case "SHARES_SPLIT":
      applySplit(state, event);
      break;
    case "SHARES_RENUMBERED":
      applyRenumbering(state, context, event);
      break;
    case "SOURCE_ACTIVITY_RECORDED":
      break;
  }
}

function retireReversedRanges(
  state: MutableState,
  reversal: EventReversed,
  targetEventId: string,
  ranges: readonly ShareRange[],
): void {
  state.retiredRanges.push(
    ...ranges.map((range) => ({
      range,
      source: "REVERSAL" as const,
      sourceEventId: reversal.id,
      targetEventId,
      operationId: reversal.operationId,
      reusable: true,
    })),
  );
}

function reverseIssuance(state: MutableState, reversal: EventReversed, target: SharesIssued): void {
  assertOwnership(
    state,
    target.payload.shareholderId,
    target.payload.shareClassId,
    target.payload.ranges,
  );
  removeHoldings(
    state,
    target.payload.shareholderId,
    target.payload.shareClassId,
    target.payload.ranges,
  );
  retireReversedRanges(state, reversal, target.id, target.payload.ranges);
}

function reverseTransfer(
  state: MutableState,
  reversal: EventReversed,
  target: SharesTransferred,
): void {
  transferHoldings(
    state,
    target.payload.transfereeId,
    target.payload.transferorId,
    target.payload.shareClassId,
    target.payload.ranges,
  );
  void reversal;
}

function reverseCancellation(state: MutableState, target: SharesCancelled): void {
  const retiredByTarget = state.retiredRanges.filter(
    (retired) => retired.source === "CANCELLATION" && retired.sourceEventId === target.id,
  );
  assertRule(
    rangesEqual(
      target.payload.ranges,
      retiredByTarget.map(({ range }) => range),
    ),
    "CANCELLATION_NOT_RESTORABLE",
    "Only ranges still retired by the target cancellation can be restored",
  );
  assertRule(
    intersectRanges(activeRanges(state), target.payload.ranges).length === 0,
    "CANCELLATION_NOT_RESTORABLE",
    "Cancelled ranges are no longer available for restoration",
  );
  state.retiredRanges = state.retiredRanges.filter((retired) => !retiredByTarget.includes(retired));
  addHoldings(
    state,
    target.payload.shareholderId,
    target.payload.shareClassId,
    target.payload.ranges,
  );
}

function reverseDetailsChange(state: MutableState, target: ShareholderDetailsChanged): void {
  const current = state.shareholderDetails.get(target.payload.shareholderId);
  assertRule(
    current && detailsEqual(current, target.payload.after),
    "DETAILS_NOT_REVERSIBLE",
    "Shareholder details changed after the target event",
  );
  state.shareholderDetails.set(target.payload.shareholderId, target.payload.before);
}

function assertOpeningCorrectionBatch(
  context: ProjectionContext,
  reversalIndex: number,
  reversal: EventReversed,
  target: OpeningStateImported,
): OpeningStateImported {
  assertRule(
    context.orderedEvents[reversalIndex - 1]?.id === target.id,
    "OPENING_REVERSAL_NOT_ATOMIC",
    "Opening reversal must immediately follow the opening in effective order",
  );
  const replacement = context.orderedEvents[reversalIndex + 1];
  assertRule(
    replacement?.type === "OPENING_STATE_IMPORTED" &&
      replacement.operationId === reversal.operationId &&
      replacement.effectiveDate === reversal.effectiveDate &&
      replacement.sequence === reversal.sequence + 1 &&
      rangesEqual(eventRanges(target), eventRanges(replacement)),
    "OPENING_REVERSAL_NOT_ATOMIC",
    "Opening reversal requires an immediate exact replacement in the same operation",
  );
  return replacement;
}

function reverseOpening(
  state: MutableState,
  context: ProjectionContext,
  reversal: OpeningReversal,
): void {
  assertOpeningCorrectionBatch(context, reversal.eventIndex, reversal.event, reversal.target);
  assertRule(
    state.activeOpeningEventId === reversal.target.id,
    "OPENING_NOT_REVERSIBLE",
    "Target opening is not the active opening",
  );
  for (const holding of reversal.target.payload.holdings) {
    assertOwnership(state, holding.shareholderId, holding.shareClassId, holding.ranges);
    removeHoldings(state, holding.shareholderId, holding.shareClassId, holding.ranges);
  }
  retireReversedRanges(state, reversal.event, reversal.target.id, eventRanges(reversal.target));
  state.activeOpeningEventId = undefined;
}

function applyReversal(
  state: MutableState,
  context: ProjectionContext,
  eventIndex: number,
  event: EventReversed,
): void {
  const target = context.eventsById.get(event.payload.targetEventId);
  assertRule(target, "REVERSAL_TARGET_MISSING", "Reversal target does not exist at this cutoff");
  assertRule(
    target.type !== "EVENT_REVERSED",
    "REVERSAL_OF_REVERSAL",
    "Reversals cannot be reversed",
  );
  assertRule(
    !state.reversedEventIds.has(target.id),
    "ALREADY_REVERSED",
    "The target event has already been reversed",
  );
  assertRule(
    state.appliedEventIds.includes(target.id),
    "REVERSAL_TARGET_NOT_APPLIED",
    "Reversal target has not been applied",
  );
  assertRule(
    target.effectiveDate <= event.effectiveDate,
    "REVERSAL_BEFORE_TARGET",
    "Reversal cannot be effective before its target",
  );
  assertRule(
    target.sequence < event.sequence &&
      Date.parse(target.registeredAt) <= Date.parse(event.registeredAt),
    "REVERSAL_TARGET_NOT_EARLIER",
    "Reversal target must not have been registered after the reversal",
  );
  if (isStructuralEvent(target)) {
    fail("EVENT_TYPE_NOT_REVERSIBLE", `Event type ${target.type} is not reversible`);
  }

  switch (target.type) {
    case "OPENING_STATE_IMPORTED":
      reverseOpening(state, context, { eventIndex, event, target });
      break;
    case "SHARES_ISSUED":
      reverseIssuance(state, event, target);
      break;
    case "SHARES_TRANSFERRED":
      reverseTransfer(state, event, target);
      break;
    case "SHARES_CANCELLED":
      reverseCancellation(state, target);
      break;
    case "SHAREHOLDER_DETAILS_CHANGED":
      reverseDetailsChange(state, target);
      break;
  }
  state.reversedEventIds.add(target.id);
}

function applyEvent(
  state: MutableState,
  context: ProjectionContext,
  event: ShareRegisterDomainEvent,
  eventIndex: number,
): void {
  if (isStructuralEvent(event)) {
    applyStructuralEvent(state, context, event);
    state.appliedEventIds.push(event.id);
    return;
  }
  switch (event.type) {
    case "OPENING_STATE_IMPORTED":
      applyOpening(state, context, event);
      break;
    case "SHARES_ISSUED":
      applyIssuance(state, context, event);
      break;
    case "SHARES_TRANSFERRED":
      applyTransfer(state, context, event);
      break;
    case "SHARES_CANCELLED":
      applyCancellation(state, context, event);
      break;
    case "SHAREHOLDER_DETAILS_CHANGED":
      applyDetailsChange(state, context, event);
      break;
    case "EVENT_REVERSED":
      applyReversal(state, context, eventIndex, event);
      break;
  }
  state.appliedEventIds.push(event.id);
}

function isKnownAt(registeredAt: string, knownAt?: string): boolean {
  return !knownAt || Date.parse(registeredAt) <= Date.parse(knownAt);
}

type CatalogEntry = Readonly<{
  id: string;
  companyId: string;
  registeredAt: string;
}>;

function buildCatalog<T extends CatalogEntry>(options: {
  inputs: readonly unknown[];
  parse: (input: unknown) => T;
  companyId: string;
  knownAt?: string;
  crossCompanyCode: string;
  crossCompanyMessage: (entry: T) => string;
  duplicateCode: string;
}): Map<string, T> {
  const catalog = new Map<string, T>();
  const ids = new Set<string>();
  for (const input of options.inputs) {
    const entry = options.parse(input);
    assertRule(
      entry.companyId === options.companyId,
      options.crossCompanyCode,
      options.crossCompanyMessage(entry),
    );
    assertRule(!ids.has(entry.id), options.duplicateCode, entry.id);
    ids.add(entry.id);
    if (isKnownAt(entry.registeredAt, options.knownAt)) catalog.set(entry.id, entry);
  }
  return catalog;
}

const shareholderCatalogBuilder = {
  parse: parseShareholder,
  crossCompanyCode: "CROSS_COMPANY_SHAREHOLDER",
  crossCompanyMessage: (shareholder: Shareholder) =>
    `Shareholder ${shareholder.id} belongs to another company`,
  duplicateCode: "DUPLICATE_SHAREHOLDER",
};

const shareClassCatalogBuilder = {
  parse: parseShareClass,
  crossCompanyCode: "CROSS_COMPANY_SHARE_CLASS",
  crossCompanyMessage: (shareClass: ShareClass) =>
    `Share class ${shareClass.id} belongs to another company`,
  duplicateCode: "DUPLICATE_SHARE_CLASS",
};

function validateCatalogs(input: ShareRegisterInput, knownAt?: string): ProjectionContext {
  return {
    shareholders: buildCatalog({
      ...shareholderCatalogBuilder,
      inputs: input.shareholders,
      companyId: input.companyId,
      knownAt,
    }),
    shareClasses: buildCatalog({
      ...shareClassCatalogBuilder,
      inputs: input.shareClasses,
      companyId: input.companyId,
      knownAt,
    }),
    eventsById: new Map(),
    orderedEvents: [],
  };
}

function validateEventMetadata(
  input: ShareRegisterInput,
  events: readonly ShareRegisterDomainEvent[],
): Map<string, ShareRegisterDomainEvent> {
  const eventsById = new Map<string, ShareRegisterDomainEvent>();
  const sequences = new Set<number>();
  for (const event of events) {
    assertRule(
      event.companyId === input.companyId,
      "CROSS_COMPANY_EVENT",
      `Event ${event.id} belongs to another company`,
    );
    assertRule(!eventsById.has(event.id), "DUPLICATE_EVENT_ID", `Duplicate event ID: ${event.id}`);
    assertRule(
      !sequences.has(event.sequence),
      "DUPLICATE_SEQUENCE",
      `Duplicate company sequence: ${event.sequence}`,
    );
    eventsById.set(event.id, event);
    sequences.add(event.sequence);
  }
  validateOperationContiguity(events);
  return eventsById;
}

function validateOperationContiguity(events: readonly ShareRegisterDomainEvent[]): void {
  const closedOperations = new Set<string>();
  let currentOperation: string | undefined;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.operationId === currentOperation) continue;
    if (currentOperation) closedOperations.add(currentOperation);
    assertRule(
      !closedOperations.has(event.operationId),
      "NONCONTIGUOUS_OPERATION",
      `Operation ${event.operationId} is not a contiguous persisted batch`,
    );
    currentOperation = event.operationId;
  }
}

function selectEvents(
  events: readonly ShareRegisterDomainEvent[],
  effectiveOn?: string,
  knownAt?: string,
): ShareRegisterDomainEvent[] {
  const knownAtTime = knownAt ? Date.parse(knownAt) : undefined;
  return events
    .filter((event) => !effectiveOn || event.effectiveDate <= effectiveOn)
    .filter((event) => knownAtTime === undefined || Date.parse(event.registeredAt) <= knownAtTime)
    .sort(compareEvents);
}

function initialState(input: ShareRegisterInput, context: ProjectionContext): MutableState {
  return {
    companyId: input.companyId,
    holdings: [],
    retiredRanges: [],
    shareholderDetails: new Map(
      [...context.shareholders.values()].map((shareholder) => [
        shareholder.id,
        shareholder.initialDetails,
      ]),
    ),
    appliedEventIds: [],
    reversedEventIds: new Set(),
    hasOpeningHistory: false,
  };
}

function immutableState(state: MutableState): ShareRegisterState {
  return Object.freeze({
    companyId: state.companyId,
    ...(state.shareCapital ? { shareCapital: state.shareCapital } : {}),
    holdings: Object.freeze(canonicalizeHoldings(state.holdings)),
    retiredRanges: Object.freeze([...state.retiredRanges]),
    shareholderDetails: Object.freeze(
      [...state.shareholderDetails]
        .map(([shareholderId, details]) => Object.freeze({ shareholderId, details }))
        .sort((left, right) => left.shareholderId.localeCompare(right.shareholderId)),
    ),
    appliedEventIds: Object.freeze([...state.appliedEventIds]),
    reversedEventIds: Object.freeze([...state.reversedEventIds].sort()),
    ...(state.activeOpeningEventId ? { activeOpeningEventId: state.activeOpeningEventId } : {}),
  });
}

export function projectShareRegister(input: ShareRegisterInput): ShareRegisterState {
  const effectiveOn = input.effectiveOn ? parseEffectiveDate(input.effectiveOn) : undefined;
  const knownAt = input.knownAt ? parseRegisteredAt(input.knownAt) : undefined;
  const parsedEvents = parseShareRegisterEvents(input.events);
  const context = validateCatalogs(input, knownAt);
  const allEventsById = validateEventMetadata(input, parsedEvents);
  const orderedEvents = selectEvents(parsedEvents, effectiveOn, knownAt);
  context.eventsById = new Map(
    orderedEvents.map((event) => [
      event.id,
      allEventsById.get(event.id) as ShareRegisterDomainEvent,
    ]),
  );
  context.orderedEvents = orderedEvents;

  const state = initialState(input, context);
  for (const [index, event] of orderedEvents.entries()) {
    applyEvent(state, context, event, index);
  }
  return immutableState(state);
}

function snapshotDetails(
  input: ShareRegisterInput,
  state: ShareRegisterState,
): ShareRegisterSnapshot["shareholderDetails"] {
  return state.shareholderDetails
    .filter(({ shareholderId }) => {
      const shareholder = input.shareholders.find(({ id }) => id === shareholderId);
      return (
        shareholder &&
        (!input.effectiveOn || shareholder.effectiveFrom <= input.effectiveOn) &&
        (!input.knownAt || Date.parse(shareholder.registeredAt) <= Date.parse(input.knownAt))
      );
    })
    .map(({ shareholderId, details }) => ({ shareholderId, details }));
}

function snapshotTotals(holdings: readonly Holding[]): ShareRegisterSnapshot["totalsByClass"] {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    totals.set(
      holding.shareClassId,
      (totals.get(holding.shareClassId) ?? 0) + countRanges([holding.range]),
    );
  }
  return [...totals]
    .map(([shareClassId, total]) => ({ shareClassId, total }))
    .sort((left, right) => left.shareClassId.localeCompare(right.shareClassId));
}

function snapshotShareholderTotals(
  holdings: readonly Holding[],
): ShareRegisterSnapshot["totalsByShareholder"] {
  const totals = new Map<string, number>();
  for (const holding of holdings) {
    totals.set(
      holding.shareholderId,
      (totals.get(holding.shareholderId) ?? 0) + countRanges([holding.range]),
    );
  }
  return [...totals]
    .map(([shareholderId, total]) => ({ shareholderId, total }))
    .sort(
      (left, right) =>
        right.total - left.total || left.shareholderId.localeCompare(right.shareholderId),
    );
}

export function createShareRegisterSnapshot(input: ShareRegisterInput): ShareRegisterSnapshot {
  const state = projectShareRegister(input);
  const eventsById = new Map(
    parseShareRegisterEvents(input.events).map((event) => [event.id, event]),
  );
  const appliedSequences = state.appliedEventIds.flatMap((eventId) => {
    const sequence = eventsById.get(eventId)?.sequence;
    return sequence === undefined ? [] : [sequence];
  });
  const lastAppliedSequence =
    appliedSequences.length > 0 ? Math.max(...appliedSequences) : undefined;

  return Object.freeze({
    companyId: input.companyId,
    ...(state.shareCapital ? { shareCapital: state.shareCapital } : {}),
    ...(input.effectiveOn ? { effectiveOn: input.effectiveOn } : {}),
    ...(input.knownAt ? { knownAt: input.knownAt } : {}),
    holdings: state.holdings,
    shareholderDetails: Object.freeze(snapshotDetails(input, state)),
    totalsByClass: Object.freeze(snapshotTotals(state.holdings)),
    totalsByShareholder: Object.freeze(snapshotShareholderTotals(state.holdings)),
    appliedEventIds: state.appliedEventIds,
    ...(lastAppliedSequence === undefined ? {} : { lastAppliedSequence }),
  });
}
