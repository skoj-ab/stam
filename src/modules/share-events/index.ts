import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import {
  companies,
  currentShareholderDetails,
  currentShareRanges,
  shareEvents,
} from "../../db/schema.ts";
import {
  createShareRegisterSnapshot,
  effectiveDateSchema,
  parseShareRegisterEvent,
  projectShareRegister,
  type ShareholderDetailsChanged,
  type ShareRegisterEvent,
  type ShareRegisterSnapshot,
  shareholderDetailsSchema,
} from "../../domain/share-register/index.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { ApplicationConflictError } from "../errors.ts";
import { loadShareRegister, type PersistedShareRegister } from "../share-register/index.ts";

const nonemptyStringSchema = z.string().trim().min(1);
const eventTypeSchema = z.enum([
  "OPENING_STATE_IMPORTED",
  "SHARES_ISSUED",
  "SHARES_TRANSFERRED",
  "SHARES_CANCELLED",
  "SHAREHOLDER_DETAILS_CHANGED",
  "SHARE_CAPITAL_CHANGED",
  "SHARES_SPLIT",
  "SHARES_RENUMBERED",
  "SOURCE_ACTIVITY_RECORDED",
  "EVENT_REVERSED",
]);

export const shareEventDraftSchema = z
  .object({
    effectiveDate: effectiveDateSchema,
    type: eventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const shareEventDraftBatchSchema = z.array(shareEventDraftSchema).min(1);

type DraftFromEvent<T extends ShareRegisterEvent> = T extends ShareholderDetailsChanged
  ? Readonly<{
      effectiveDate: T["effectiveDate"];
      type: T["type"];
      payload: Readonly<{
        shareholderId: string;
        after: T["payload"]["after"];
      }>;
    }>
  : Readonly<{
      effectiveDate: T["effectiveDate"];
      type: T["type"];
      payload: T["payload"];
    }>;

export type ShareEventDraft = DraftFromEvent<ShareRegisterEvent>;
export type ShareEventDraftInput = z.input<typeof shareEventDraftBatchSchema>;

export type AppendShareEventsResult = Readonly<{
  events: readonly ShareRegisterEvent[];
  currentSnapshot: ShareRegisterSnapshot;
}>;

type PreparedShareEvents = Readonly<{
  result: AppendShareEventsResult;
  activatesCompany: boolean;
}>;

type EventOperation = Readonly<{
  operationId: string;
  registeredAt: string;
}>;

export type ShareEventAuditMetadata = Readonly<{
  kind: string;
  details?: Readonly<Record<string, unknown>>;
}>;

export type CompanyShareEventBatch = Readonly<{
  companyId: string;
  drafts: readonly ShareEventDraft[] | ShareEventDraftInput;
}>;

export type CompanyShareEventBatchResult = Readonly<{
  companyId: string;
  result: AppendShareEventsResult;
}>;

const detailsChangeDraftPayloadSchema = z
  .object({
    shareholderId: nonemptyStringSchema,
    after: shareholderDetailsSchema,
  })
  .strict();

function assertEmptyOcfBootstrapAuthorized(
  drafts: readonly z.output<typeof shareEventDraftSchema>[],
  authorized: boolean,
): void {
  const hasEmptyOpening = drafts.some(
    (draft) =>
      draft.type === "OPENING_STATE_IMPORTED" &&
      Array.isArray(draft.payload.holdings) &&
      draft.payload.holdings.length === 0,
  );
  if (hasEmptyOpening && !authorized) {
    throw new ApplicationConflictError(
      "An empty OCF opening marker may only be created by the OCF transaction-history importer",
    );
  }
}

function registrationTimestamp(events: readonly ShareRegisterEvent[]): string {
  const latestPersisted = events.reduce(
    (latest, event) => Math.max(latest, Date.parse(event.registeredAt)),
    0,
  );
  return new Date(Math.max(Date.now(), latestPersisted + 1)).toISOString();
}

function detailsBeforeChange(
  register: PersistedShareRegister,
  priorCandidates: readonly ShareRegisterEvent[],
  effectiveOn: string,
  shareholderId: string,
) {
  const snapshot = createShareRegisterSnapshot({
    ...register,
    events: [...register.events, ...priorCandidates],
    effectiveOn,
  });
  const details = snapshot.shareholderDetails.find(
    (entry) => entry.shareholderId === shareholderId,
  )?.details;
  if (!details) {
    throw new ApplicationConflictError(
      `Shareholder is not available for a details change: ${shareholderId}`,
    );
  }
  return details;
}

function createCandidates(
  register: PersistedShareRegister,
  drafts: readonly z.output<typeof shareEventDraftSchema>[],
  registeredBy: string,
  operation?: EventOperation,
): readonly ShareRegisterEvent[] {
  const operationId = operation?.operationId ?? randomUUID();
  const registeredAt = operation?.registeredAt ?? registrationTimestamp(register.events);
  const firstSequence = register.events.reduce(
    (largest, event) => Math.max(largest, event.sequence),
    0,
  );
  const candidates: ShareRegisterEvent[] = [];

  for (const [index, draft] of drafts.entries()) {
    let payload: Record<string, unknown> = draft.payload;
    if (draft.type === "SHAREHOLDER_DETAILS_CHANGED") {
      const detailsDraft = detailsChangeDraftPayloadSchema.parse(draft.payload);
      const before = detailsBeforeChange(
        register,
        candidates,
        draft.effectiveDate,
        detailsDraft.shareholderId,
      );
      payload = {
        shareholderId: detailsDraft.shareholderId,
        before,
        after: detailsDraft.after,
      };
    }

    candidates.push(
      parseShareRegisterEvent({
        id: randomUUID(),
        companyId: register.companyId,
        sequence: firstSequence + index + 1,
        schemaVersion: 1,
        effectiveDate: draft.effectiveDate,
        registeredAt,
        registeredBy,
        operationId,
        type: draft.type,
        payload,
      }),
    );
  }
  return Object.freeze(candidates);
}

function insertEvents(database: DatabaseContext, events: readonly ShareRegisterEvent[]): void {
  database.db
    .insert(shareEvents)
    .values(
      events.map((event) => ({
        ...event,
        reversalTargetId: event.type === "EVENT_REVERSED" ? event.payload.targetEventId : null,
      })),
    )
    .run();
}

function prepareShareEvents(
  register: PersistedShareRegister,
  drafts: readonly z.output<typeof shareEventDraftSchema>[],
  registeredBy: string,
  operation?: EventOperation,
): PreparedShareEvents {
  const candidates = createCandidates(register, drafts, registeredBy, operation);
  const completeEvents = [...register.events, ...candidates];
  const fullState = projectShareRegister({ ...register, events: completeEvents });
  const currentSnapshot = createShareRegisterSnapshot({
    ...register,
    events: completeEvents,
    effectiveOn: new Date().toISOString().slice(0, 10),
  });
  return Object.freeze({
    result: Object.freeze({ events: candidates, currentSnapshot }),
    activatesCompany: Boolean(fullState.activeOpeningEventId),
  });
}

function persistPreparedShareEvents(
  database: DatabaseContext,
  companyId: string,
  prepared: PreparedShareEvents,
  options: Readonly<{
    actorUserId: string;
    auditMetadata?: ShareEventAuditMetadata;
  }>,
): void {
  insertEvents(database, prepared.result.events);
  rebuildCurrentProjection(database, companyId, prepared.result.currentSnapshot);
  if (prepared.activatesCompany) {
    database.db
      .update(companies)
      .set({ status: "ACTIVE" })
      .where(eq(companies.id, companyId))
      .run();
  }
  const openingEvents = prepared.result.events.filter(
    (event) => event.type === "OPENING_STATE_IMPORTED",
  );
  if (openingEvents.length > 0) {
    recordAuditEvent(database, {
      type: "IMPORT_COMMITTED",
      outcome: "SUCCEEDED",
      actorKind: "USER",
      actorUserId: options.actorUserId,
      companyId,
      operationId: openingEvents[0]?.operationId,
      payload: {
        ...options.auditMetadata?.details,
        kind: options.auditMetadata?.kind ?? "OPENING_MANUAL",
        eventCount: openingEvents.length,
        eventIds: openingEvents.map((event) => event.id),
      },
    });
  }
}

function parseCompanyBatches(batches: readonly CompanyShareEventBatch[]) {
  return batches.map(({ companyId, drafts }) => {
    const parsedDrafts = shareEventDraftBatchSchema.parse(drafts);
    assertEmptyOcfBootstrapAuthorized(parsedDrafts, false);
    return {
      companyId: nonemptyStringSchema.parse(companyId),
      drafts: parsedDrafts,
    };
  });
}

function batchOperation(registers: readonly PersistedShareRegister[]): EventOperation {
  return {
    operationId: randomUUID(),
    registeredAt: registrationTimestamp(registers.flatMap(({ events }) => events)),
  };
}

function rebuildCurrentProjection(
  database: DatabaseContext,
  companyId: string,
  currentSnapshot: ShareRegisterSnapshot,
): void {
  database.db.delete(currentShareRanges).where(eq(currentShareRanges.companyId, companyId)).run();
  database.db
    .delete(currentShareholderDetails)
    .where(eq(currentShareholderDetails.companyId, companyId))
    .run();

  if (currentSnapshot.holdings.length > 0) {
    database.db
      .insert(currentShareRanges)
      .values(
        currentSnapshot.holdings.map((holding) => ({
          companyId,
          shareholderId: holding.shareholderId,
          shareClassId: holding.shareClassId,
          rangeFrom: holding.range.from,
          rangeTo: holding.range.to,
        })),
      )
      .run();
  }
  if (currentSnapshot.shareholderDetails.length > 0) {
    database.db
      .insert(currentShareholderDetails)
      .values(
        currentSnapshot.shareholderDetails.map(({ shareholderId, details }) => ({
          shareholderId,
          companyId,
          details,
        })),
      )
      .run();
  }
}

export function previewShareEvents(
  database: DatabaseContext,
  companyId: string,
  draftsInput: readonly ShareEventDraft[] | ShareEventDraftInput,
  registeredBy: string,
): AppendShareEventsResult {
  const drafts = shareEventDraftBatchSchema.parse(draftsInput);
  assertEmptyOcfBootstrapAuthorized(drafts, false);
  const caller = nonemptyStringSchema.parse(registeredBy);
  const register = loadShareRegister(database, companyId);
  return prepareShareEvents(register, drafts, caller).result;
}

export function appendShareEvents(
  database: DatabaseContext,
  companyId: string,
  draftsInput: readonly ShareEventDraft[] | ShareEventDraftInput,
  registeredBy: string,
  auditMetadata?: ShareEventAuditMetadata,
): AppendShareEventsResult {
  const drafts = shareEventDraftBatchSchema.parse(draftsInput);
  assertEmptyOcfBootstrapAuthorized(drafts, auditMetadata?.kind === "OCF_V1_2_0");
  const caller = nonemptyStringSchema.parse(registeredBy);

  const persist = () => {
    const register = loadShareRegister(database, companyId);
    const prepared = prepareShareEvents(register, drafts, caller);
    persistPreparedShareEvents(database, companyId, prepared, {
      actorUserId: caller,
      auditMetadata,
    });
    return prepared.result;
  };
  return database.sqlite.inTransaction
    ? persist()
    : withImmediateTransaction(database.sqlite, persist);
}

export function previewShareEventBatches(
  database: DatabaseContext,
  batchesInput: readonly CompanyShareEventBatch[],
  registeredBy: string,
): readonly CompanyShareEventBatchResult[] {
  const batches = parseCompanyBatches(batchesInput);
  const caller = nonemptyStringSchema.parse(registeredBy);
  const registers = batches.map(({ companyId }) => loadShareRegister(database, companyId));
  const operation = batchOperation(registers);
  return Object.freeze(
    batches.map(({ companyId, drafts }, index) => ({
      companyId,
      result: prepareShareEvents(
        registers[index] as PersistedShareRegister,
        drafts,
        caller,
        operation,
      ).result,
    })),
  );
}

export function appendShareEventBatches(
  database: DatabaseContext,
  batchesInput: readonly CompanyShareEventBatch[],
  registeredBy: string,
): readonly CompanyShareEventBatchResult[] {
  const batches = parseCompanyBatches(batchesInput);
  const caller = nonemptyStringSchema.parse(registeredBy);
  return withImmediateTransaction(database.sqlite, () => {
    const registers = batches.map(({ companyId }) => loadShareRegister(database, companyId));
    const operation = batchOperation(registers);
    const prepared = batches.map(({ companyId, drafts }, index) => ({
      companyId,
      prepared: prepareShareEvents(
        registers[index] as PersistedShareRegister,
        drafts,
        caller,
        operation,
      ),
    }));
    for (const batch of prepared) {
      persistPreparedShareEvents(database, batch.companyId, batch.prepared, {
        actorUserId: caller,
      });
    }
    return Object.freeze(
      prepared.map(({ companyId, prepared: events }) => ({ companyId, result: events.result })),
    );
  });
}
