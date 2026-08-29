import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import {
  type DatabaseContext,
  openDatabase,
  withImmediateTransaction,
} from "../../src/db/database.ts";
import { migrateDatabase } from "../../src/db/migrate.ts";
import { currentShareholderDetails, currentShareRanges, shareEvents } from "../../src/db/schema.ts";
import type {
  ShareholderDetails,
  ShareholderDetailsChanged,
  ShareRegisterEvent,
} from "../../src/domain/share-register/index.ts";
import { createCompany, getCompany, listCompanies } from "../../src/modules/companies/index.ts";
import {
  getCurrentShareRegisterSnapshot,
  getHistoricalShareRegisterSnapshot,
} from "../../src/modules/projections/index.ts";
import { createShareClass, listShareClasses } from "../../src/modules/share-classes/index.ts";
import {
  appendShareEvents,
  type ShareEventDraft,
  type ShareEventDraftInput,
} from "../../src/modules/share-events/index.ts";
import {
  appendMultiCompanyShareholderDetailsChange,
  previewMultiCompanyShareholderDetailsChange,
} from "../../src/modules/shareholder-details/index.ts";
import {
  listShareholderCompanyMatches,
  listShareholderCopyCandidates,
} from "../../src/modules/shareholder-directory/index.ts";
import { createShareholder, listShareholders } from "../../src/modules/shareholders/index.ts";

const userId = "user-1";
const effectiveFrom = "2024-01-01";

function details({ legalName }: { legalName: string }) {
  return {
    legalName,
    address: {
      lines: [`${legalName} street 1`],
      postalCode: "111 11",
      locality: "Stockholm",
      countryCode: "SE",
    },
  };
}

function withDatabase<T>(operation: (database: DatabaseContext, path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "stam-integration-"));
  const path = join(directory, "stam.sqlite");
  const database = openDatabase(path);
  try {
    migrateDatabase(database);
    return operation(database, path);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function setupCatalog(database: DatabaseContext) {
  const company = createCompany(
    database,
    {
      legalName: "Example AB",
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: "556016-0680",
    },
    userId,
  );
  const alice = createShareholder(
    database,
    {
      companyId: company.id,
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "811218-9876",
      initialDetails: details({ legalName: "Alice Andersson" }),
      effectiveFrom,
    },
    userId,
  );
  const bob = createShareholder(
    database,
    {
      companyId: company.id,
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "640823-3234",
      initialDetails: details({ legalName: "Bob Berg" }),
      effectiveFrom,
    },
    userId,
  );
  const carol = createShareholder(
    database,
    {
      companyId: company.id,
      kind: "LEGAL_ENTITY",
      identifierCountryCode: "SE",
      identifierScheme: "ORGANISATIONSNUMMER",
      identifierValue: "556016-0680",
      initialDetails: details({ legalName: "Carol AB" }),
      effectiveFrom,
    },
    userId,
  );
  const classA = createShareClass(
    database,
    { companyId: company.id, name: "A", votesPerShare: "1", effectiveFrom },
    userId,
  );
  const classB = createShareClass(
    database,
    { companyId: company.id, name: "B", votesPerShare: "0.1", effectiveFrom },
    userId,
  );
  return { company, alice, bob, carol, classA, classB };
}

function setupMatchingCompany(
  database: DatabaseContext,
  companyIdentity: { legalName: string; registrationValue: string },
) {
  const company = createCompany(
    database,
    {
      legalName: companyIdentity.legalName,
      registrationCountry: "SE",
      registrationScheme: "ORGANISATIONSNUMMER",
      registrationValue: companyIdentity.registrationValue,
    },
    userId,
  );
  const shareholder = createShareholder(
    database,
    {
      companyId: company.id,
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "811218-9876",
      initialDetails: details({ legalName: "Alice Andersson" }),
      effectiveFrom,
    },
    userId,
  );
  return { company, shareholder };
}

function openingDraft(
  holdings: ReadonlyArray<{
    shareholderId: string;
    shareClassId: string;
    ranges: ReadonlyArray<{ from: number; to: number }>;
  }>,
): ShareEventDraft {
  return {
    effectiveDate: "2024-01-01",
    type: "OPENING_STATE_IMPORTED",
    payload: {
      holdings,
      sourceType: "SHARE_REGISTER",
      importNote: "Verified against the signed share register",
    },
  };
}

function structuralDrafts({
  shareholderId,
  shareClassId,
}: {
  shareholderId: string;
  shareClassId: string;
}): ShareEventDraftInput {
  return [
    {
      effectiveDate: "2024-02-01",
      type: "SHARE_CAPITAL_CHANGED",
      payload: { after: { amount: "50000", currency: "SEK" }, reason: "FORMATION" },
    },
    { effectiveDate: "2024-03-01", type: "SHARES_SPLIT", payload: { factor: 2 } },
    {
      effectiveDate: "2024-03-01",
      type: "SOURCE_ACTIVITY_RECORDED",
      payload: {
        sourceEventId: "source:1",
        category: "Import",
        description: "Source evidence",
      },
    },
    {
      effectiveDate: "2024-04-01",
      type: "SHARES_RENUMBERED",
      payload: {
        holdings: [
          {
            shareholderId,
            shareClassId,
            ranges: [{ from: 10, to: 13 }],
          },
        ],
        note: "Verified renumbering",
      },
    },
  ];
}

function transferDraft({
  effectiveDate,
  payload,
}: {
  effectiveDate: string;
  payload: Extract<ShareEventDraft, { type: "SHARES_TRANSFERRED" }>["payload"];
}): ShareEventDraft {
  return { effectiveDate, type: "SHARES_TRANSFERRED", payload };
}

function issuanceDraft({
  effectiveDate,
  payload,
}: {
  effectiveDate: string;
  payload: Extract<ShareEventDraft, { type: "SHARES_ISSUED" }>["payload"];
}): ShareEventDraft {
  return { effectiveDate, type: "SHARES_ISSUED", payload };
}

function detailsChangeDraft([effectiveDate, shareholderId, after]: readonly [
  string,
  string,
  ShareholderDetails,
]): ShareEventDraft {
  const { legalName, address, emailAddress, phoneNumber } = after;
  return {
    effectiveDate,
    type: "SHAREHOLDER_DETAILS_CHANGED",
    payload: { shareholderId, after: { legalName, address, emailAddress, phoneNumber } },
  };
}

function reversalDraft([effectiveDate, targetEventId, explanation]: readonly [
  string,
  string,
  string,
]): ShareEventDraft {
  return {
    effectiveDate,
    type: "EVENT_REVERSED",
    payload: { targetEventId, explanation },
  };
}

function appendDrafts(
  database: DatabaseContext,
  company: { id: string },
  ...drafts: readonly ShareEventDraft[]
) {
  return appendShareEvents(database, company.id, drafts, userId);
}

function requireDetailsChangeEvent(
  event: ShareRegisterEvent | undefined,
): ShareholderDetailsChanged {
  if (event?.type !== "SHAREHOLDER_DETAILS_CHANGED") {
    throw new Error("Expected shareholder details change event");
  }
  return event;
}

describe("SQLite application repositories", () => {
  test("validates setup inputs and lists server-owned catalog records", () => {
    withDatabase((database) => {
      expect(() =>
        createCompany(
          database,
          {
            legalName: "Invalid AB",
            registrationCountry: "se",
            registrationScheme: "ORG",
            registrationValue: "1",
          },
          userId,
        ),
      ).toThrow();

      const catalog = setupCatalog(database);
      expect(catalog.company.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(catalog.company.status).toBe("DRAFT");
      expect(catalog.company.createdBy).toBe(userId);
      expect(listCompanies(database).map(({ id }) => id)).toEqual([catalog.company.id]);
      expect(listShareholders(database, catalog.company.id)).toHaveLength(3);
      expect(listShareClasses(database, catalog.company.id).map(({ name }) => name)).toEqual([
        "A",
        "B",
      ]);
      expect(() =>
        createShareClass(
          database,
          {
            companyId: catalog.company.id,
            name: "Invalid",
            votesPerShare: "1e3",
            effectiveFrom,
          },
          userId,
        ),
      ).toThrow();
    });
  });

  test("normalizes shareholder identifiers and enforces company-scoped uniqueness", () => {
    withDatabase((database) => {
      const { company, alice } = setupCatalog(database);
      expect(alice.identifierValue).toBe("8112189876");
      expect(() =>
        createShareholder(
          database,
          {
            companyId: company.id,
            kind: "INDIVIDUAL",
            identifierCountryCode: "SE",
            identifierScheme: "PERSONNUMMER",
            identifierValue: "198112189876",
            initialDetails: details({ legalName: "Alice Duplicate" }),
            effectiveFrom,
          },
          userId,
        ),
      ).toThrow();

      const otherCompany = createCompany(
        database,
        {
          legalName: "Other AB",
          registrationCountry: "SE",
          registrationScheme: "ORGANISATIONSNUMMER",
          registrationValue: "556036-0793",
        },
        userId,
      );
      const sameOwner = createShareholder(
        database,
        {
          companyId: otherCompany.id,
          kind: "INDIVIDUAL",
          identifierCountryCode: "SE",
          identifierScheme: "PERSONNUMMER",
          identifierValue: "811218-9876",
          initialDetails: details({ legalName: "Alice Andersson" }),
          effectiveFrom,
        },
        userId,
      );
      expect(sameOwner.identifierValue).toBe(alice.identifierValue);
      expect(sameOwner.id).not.toBe(alice.id);
    });
  });

  test("offers current shareholders from other companies as independent copy candidates", () => {
    withDatabase((database) => {
      const { alice } = setupCatalog(database);
      const target = createCompany(
        database,
        {
          legalName: "Target AB",
          registrationCountry: "SE",
          registrationScheme: "ORGANISATIONSNUMMER",
          registrationValue: "556677-8899",
        },
        userId,
      );
      const candidate = listShareholderCopyCandidates(database, target.id).find(
        ({ identifierValue }) => identifierValue === alice.identifierValue,
      );
      if (!candidate) throw new Error("Expected Alice as a copy candidate");
      expect(candidate.details).toEqual(alice.initialDetails);

      createShareholder(
        database,
        {
          companyId: target.id,
          kind: candidate.kind,
          identifierCountryCode: candidate.identifierCountryCode,
          identifierScheme: candidate.identifierScheme,
          identifierValue: candidate.identifierValue,
          initialDetails: {
            ...candidate.details,
            address: {
              ...candidate.details.address,
              lines: [...candidate.details.address.lines],
            },
          },
          effectiveFrom,
        },
        userId,
      );
      expect(
        listShareholderCopyCandidates(database, target.id).some(
          ({ identifierValue }) => identifierValue === alice.identifierValue,
        ),
      ).toBe(false);
    });
  });

  test("previews and atomically updates matching shareholders in selected companies", () => {
    withDatabase((database) => {
      const { company, alice } = setupCatalog(database);
      const second = setupMatchingCompany(database, {
        legalName: "Second AB",
        registrationValue: "556036-0793",
      });
      const unselected = setupMatchingCompany(database, {
        legalName: "Unselected AB",
        registrationValue: "556677-8899",
      });
      expect(listShareholderCompanyMatches(database, company.id, alice.id)).toHaveLength(3);

      const after = {
        ...details({ legalName: "Alice Updated" }),
        emailAddress: "alice.updated@example.com",
        phoneNumber: "+46 70 000 00 00",
      };
      const input = {
        targetCompanyIds: [company.id, second.company.id],
        effectiveDate: "2024-05-01",
        after,
      };
      const eventsBefore = database.db.select().from(shareEvents).all().length;
      const preview = previewMultiCompanyShareholderDetailsChange({
        database,
        anchorCompanyId: company.id,
        anchorShareholderId: alice.id,
        input,
        registeredBy: userId,
      });
      expect(preview.results).toHaveLength(2);
      expect(database.db.select().from(shareEvents).all()).toHaveLength(eventsBefore);

      const appended = appendMultiCompanyShareholderDetailsChange({
        database,
        anchorCompanyId: company.id,
        anchorShareholderId: alice.id,
        input,
        registeredBy: userId,
      });
      const operationIds = appended.results.map((result) => result.events[0]?.operationId);
      expect(new Set(operationIds).size).toBe(1);
      expect(
        getCurrentShareRegisterSnapshot(database, second.company.id).shareholderDetails[0]?.details,
      ).toEqual(after);
      expect(
        getCurrentShareRegisterSnapshot(database, unselected.company.id).shareholderDetails[0]
          ?.details,
      ).toEqual(unselected.shareholder.initialDetails);
    });
  });

  test("rolls back every company when a multi-company details update fails", () => {
    withDatabase((database) => {
      const { company, alice } = setupCatalog(database);
      const second = setupMatchingCompany(database, {
        legalName: "Second AB",
        registrationValue: "556036-0793",
      });
      const eventsBefore = database.db.select().from(shareEvents).all();
      database.sqlite.exec(`
        CREATE TRIGGER reject_second_company_event
        BEFORE INSERT ON share_events
        WHEN NEW.company_id = '${second.company.id}'
        BEGIN
          SELECT RAISE(ABORT, 'forced second-company failure');
        END;
      `);

      expect(() =>
        appendMultiCompanyShareholderDetailsChange({
          database,
          anchorCompanyId: company.id,
          anchorShareholderId: alice.id,
          input: {
            targetCompanyIds: [company.id, second.company.id],
            effectiveDate: "2024-05-01",
            after: details({ legalName: "Alice Updated" }),
          },
          registeredBy: userId,
        }),
      ).toThrow("forced second-company failure");

      expect(database.db.select().from(shareEvents).all()).toEqual(eventsBefore);
      expect(
        getCurrentShareRegisterSnapshot(database, company.id).shareholderDetails.find(
          ({ shareholderId }) => shareholderId === alice.id,
        )?.details,
      ).toEqual(alice.initialDetails);
      expect(
        getCurrentShareRegisterSnapshot(database, second.company.id).shareholderDetails[0]?.details,
      ).toEqual(second.shareholder.initialDetails);
    });
  });

  test("appends an opening and partial transfer and rebuilds split, multi-class materializations", () => {
    withDatabase((database) => {
      const { company, alice, bob, classA, classB } = setupCatalog(database);
      const opened = appendShareEvents(
        database,
        company.id,
        [
          openingDraft([
            { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 100 }] },
            { shareholderId: bob.id, shareClassId: classB.id, ranges: [{ from: 101, to: 120 }] },
          ]),
        ],
        userId,
      );
      expect(opened.events[0]?.sequence).toBe(1);
      expect(getCompany(database, company.id)?.status).toBe("ACTIVE");

      const transferred = appendShareEvents(
        database,
        company.id,
        [
          {
            effectiveDate: "2024-02-01",
            type: "SHARES_TRANSFERRED",
            payload: {
              transferorId: alice.id,
              transfereeId: bob.id,
              shareClassId: classA.id,
              ranges: [{ from: 21, to: 30 }],
              reason: "SALE",
            },
          },
        ],
        userId,
      );
      expect(transferred.events[0]?.sequence).toBe(2);
      expect(transferred.currentSnapshot.totalsByClass).toEqual(
        [
          { shareClassId: classA.id, total: 100 },
          { shareClassId: classB.id, total: 20 },
        ].sort((left, right) => left.shareClassId.localeCompare(right.shareClassId)),
      );

      const materialized = database.db
        .select()
        .from(currentShareRanges)
        .where(eq(currentShareRanges.companyId, company.id))
        .orderBy(asc(currentShareRanges.rangeFrom))
        .all();
      expect(
        materialized.map(({ shareholderId, shareClassId, rangeFrom, rangeTo }) => ({
          shareholderId,
          shareClassId,
          rangeFrom,
          rangeTo,
        })),
      ).toEqual([
        { shareholderId: alice.id, shareClassId: classA.id, rangeFrom: 1, rangeTo: 20 },
        { shareholderId: bob.id, shareClassId: classA.id, rangeFrom: 21, rangeTo: 30 },
        { shareholderId: alice.id, shareClassId: classA.id, rangeFrom: 31, rangeTo: 100 },
        { shareholderId: bob.id, shareClassId: classB.id, rangeFrom: 101, rangeTo: 120 },
      ]);
      expect(getCurrentShareRegisterSnapshot(database, company.id).holdings).toEqual(
        transferred.currentSnapshot.holdings,
      );
    });
  });

  test("persists capital, split, renumbering, and source provenance events", () => {
    withDatabase((database) => {
      const { company, alice, classA } = setupCatalog(database);
      appendShareEvents(
        database,
        company.id,
        [
          openingDraft([
            { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 2 }] },
          ]),
        ],
        userId,
      );
      const appended = appendShareEvents(
        database,
        company.id,
        structuralDrafts({ shareholderId: alice.id, shareClassId: classA.id }),
        userId,
      );
      expect(appended.events.map(({ type }) => type)).toEqual([
        "SHARE_CAPITAL_CHANGED",
        "SHARES_SPLIT",
        "SOURCE_ACTIVITY_RECORDED",
        "SHARES_RENUMBERED",
      ]);
      expect(String(appended.currentSnapshot.shareCapital?.amount)).toBe("50000");
      expect(appended.currentSnapshot.holdings).toMatchObject([{ range: { from: 10, to: 13 } }]);
      expect(
        database.db
          .select({ type: shareEvents.type })
          .from(shareEvents)
          .where(eq(shareEvents.companyId, company.id))
          .orderBy(asc(shareEvents.sequence))
          .all()
          .map(({ type }) => type),
      ).toEqual([
        "OPENING_STATE_IMPORTED",
        "SHARE_CAPITAL_CHANGED",
        "SHARES_SPLIT",
        "SOURCE_ACTIVITY_RECORDED",
        "SHARES_RENUMBERED",
      ]);
    });
  });

  test("rolls back invalid and timeline-breaking backdated appends", () => {
    withDatabase((database) => {
      const { company, alice, bob, carol, classA } = setupCatalog(database);
      appendDrafts(
        database,
        company,
        openingDraft([
          { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 100 }] },
        ]),
      );
      appendDrafts(
        database,
        company,
        transferDraft({
          effectiveDate: "2024-06-01",
          payload: {
            transferorId: alice.id,
            transfereeId: bob.id,
            shareClassId: classA.id,
            ranges: [{ from: 1, to: 50 }],
            reason: "SALE",
          },
        }),
      );

      expect(() =>
        appendDrafts(
          database,
          company,
          transferDraft({
            effectiveDate: "2024-07-01",
            payload: {
              transferorId: carol.id,
              transfereeId: alice.id,
              shareClassId: classA.id,
              ranges: [{ from: 51, to: 60 }],
              reason: "OTHER",
              reasonNote: "Invalid owner",
            },
          }),
        ),
      ).toThrow("not owned");
      expect(() =>
        appendDrafts(
          database,
          company,
          transferDraft({
            effectiveDate: "2024-03-01",
            payload: {
              transferorId: alice.id,
              transfereeId: carol.id,
              shareClassId: classA.id,
              ranges: [{ from: 1, to: 50 }],
              reason: "GIFT",
            },
          }),
        ),
      ).toThrow("not owned");

      expect(database.db.select().from(shareEvents).all()).toHaveLength(2);
      expect(getCurrentShareRegisterSnapshot(database, company.id).holdings[0]?.shareholderId).toBe(
        bob.id,
      );
    });
  });

  test("commits correction batches atomically and stores reversal targets", () => {
    withDatabase((database) => {
      const { company, alice, bob, classA, classB } = setupCatalog(database);
      appendDrafts(
        database,
        company,
        openingDraft([
          { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 10 }] },
        ]),
      );
      const issue = appendDrafts(
        database,
        company,
        issuanceDraft({
          effectiveDate: "2024-02-01",
          payload: {
            shareholderId: alice.id,
            shareClassId: classA.id,
            ranges: [{ from: 11, to: 20 }],
          },
        }),
      ).events[0];
      if (!issue) throw new Error("Expected issued event");

      expect(() =>
        appendDrafts(
          database,
          company,
          reversalDraft(["2024-03-01", issue.id, "Wrong recipient"]),
          issuanceDraft({
            effectiveDate: "2024-03-01",
            payload: {
              shareholderId: bob.id,
              shareClassId: classB.id,
              ranges: [{ from: 11, to: 15 }],
            },
          }),
        ),
      ).toThrow("exact correction replacement");
      expect(database.db.select().from(shareEvents).all()).toHaveLength(2);

      const corrected = appendDrafts(
        database,
        company,
        reversalDraft(["2024-03-01", issue.id, "Wrong recipient"]),
        issuanceDraft({
          effectiveDate: "2024-03-01",
          payload: {
            shareholderId: bob.id,
            shareClassId: classB.id,
            ranges: [{ from: 11, to: 20 }],
          },
        }),
      );
      expect(corrected.events).toHaveLength(2);
      expect(corrected.events[0]?.operationId).toBe(corrected.events[1]?.operationId);
      expect(
        database.db
          .select({ reversalTargetId: shareEvents.reversalTargetId })
          .from(shareEvents)
          .where(eq(shareEvents.id, corrected.events[0]?.id ?? ""))
          .get()?.reversalTargetId,
      ).toBe(issue.id);
      expect(corrected.currentSnapshot.holdings).toContainEqual({
        shareholderId: bob.id,
        shareClassId: classB.id,
        range: { from: 11, to: 20 },
      });
    });
  });

  test("derives detail-change before values and supports effective and known-time snapshots", () => {
    withDatabase((database) => {
      const { company, alice, bob, classA } = setupCatalog(database);
      const opening = appendShareEvents(
        database,
        company.id,
        [
          openingDraft([
            { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 10 }] },
          ]),
        ],
        userId,
      ).events[0];
      if (!opening) throw new Error("Expected opening event");
      const changedDetails = {
        ...details({ legalName: "Alice Newname" }),
        emailAddress: "alice@example.com",
        phoneNumber: "+46 70 123 45 67",
      };
      const result = appendShareEvents(
        database,
        company.id,
        [
          detailsChangeDraft(["2024-05-01", alice.id, changedDetails]),
          {
            effectiveDate: "2024-06-01",
            type: "SHARES_TRANSFERRED",
            payload: {
              transferorId: alice.id,
              transfereeId: bob.id,
              shareClassId: classA.id,
              ranges: [{ from: 1, to: 5 }],
              reason: "SALE",
            },
          },
        ],
        userId,
      );
      const detailsEvent = requireDetailsChangeEvent(result.events[0]);
      expect(detailsEvent.payload.before).toEqual(alice.initialDetails);
      expect(detailsEvent.payload.after).toEqual(changedDetails);

      expect(
        getHistoricalShareRegisterSnapshot(database, company.id, {
          effectiveOn: "2024-05-31",
        }).holdings,
      ).toEqual([{ shareholderId: alice.id, shareClassId: classA.id, range: { from: 1, to: 10 } }]);
      expect(
        getHistoricalShareRegisterSnapshot(database, company.id, {
          effectiveOn: "2024-12-31",
          knownAt: opening.registeredAt,
        }).holdings,
      ).toEqual([{ shareholderId: alice.id, shareClassId: classA.id, range: { from: 1, to: 10 } }]);
      expect(
        getHistoricalShareRegisterSnapshot(database, company.id, {
          effectiveOn: "2024-12-31",
          knownAt: result.events[0]?.registeredAt,
        }).holdings[0]?.shareholderId,
      ).toBe(bob.id);
      expect(
        database.db
          .select()
          .from(currentShareholderDetails)
          .where(eq(currentShareholderDetails.shareholderId, alice.id))
          .get()?.details,
      ).toEqual(changedDetails);
    });
  });

  test("database triggers reject direct event and catalog mutation", () => {
    withDatabase((database) => {
      const { company, alice, classA } = setupCatalog(database);
      const event = appendShareEvents(
        database,
        company.id,
        [
          openingDraft([
            { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 10 }] },
          ]),
        ],
        userId,
      ).events[0];
      if (!event) throw new Error("Expected opening event");

      expect(() =>
        database.sqlite
          .query("UPDATE share_events SET effective_date = ? WHERE id = ?")
          .run("2024-02-01", event.id),
      ).toThrow("share_events are immutable");
      expect(() =>
        database.sqlite.query("DELETE FROM share_events WHERE id = ?").run(event.id),
      ).toThrow("share_events are immutable");
      expect(() =>
        database.sqlite
          .query("UPDATE shareholders SET effective_from = ? WHERE id = ?")
          .run("2024-02-01", alice.id),
      ).toThrow("shareholders are immutable");
      expect(() =>
        database.sqlite.query("DELETE FROM shareholders WHERE id = ?").run(alice.id),
      ).toThrow("shareholders are immutable");
      expect(() =>
        database.sqlite
          .query("UPDATE share_classes SET name = ? WHERE id = ?")
          .run("Changed", classA.id),
      ).toThrow("share classes are immutable");
      expect(() =>
        database.sqlite.query("DELETE FROM share_classes WHERE id = ?").run(classA.id),
      ).toThrow("share classes are immutable");
      expect(database.db.select().from(shareEvents).all()).toHaveLength(1);
    });
  });

  test("database checks reject malformed event JSON and inconsistent reversal targets", () => {
    withDatabase((database) => {
      const { company, alice, classA } = setupCatalog(database);
      const opening = appendShareEvents(
        database,
        company.id,
        [
          openingDraft([
            { shareholderId: alice.id, shareClassId: classA.id, ranges: [{ from: 1, to: 10 }] },
          ]),
        ],
        userId,
      ).events[0];
      if (!opening) throw new Error("Expected opening event");

      expect(() =>
        database.sqlite
          .query(
            `INSERT INTO share_events
            (id, company_id, sequence, schema_version, effective_date, registered_at,
             registered_by, operation_id, type, payload, reversal_target_id)
           VALUES (?, ?, 2, 1, '2024-02-01', ?, ?, ?, 'SHARES_ISSUED', ?, NULL)`,
          )
          .run(
            "corrupt-event",
            company.id,
            new Date().toISOString(),
            userId,
            "corrupt-operation",
            "{oops",
          ),
      ).toThrow();

      expect(() =>
        database.sqlite
          .query(
            `INSERT INTO share_events
            (id, company_id, sequence, schema_version, effective_date, registered_at,
             registered_by, operation_id, type, payload, reversal_target_id)
           VALUES (?, ?, 2, 1, '2024-02-01', ?, ?, ?, 'EVENT_REVERSED', ?, ?)`,
          )
          .run(
            "inconsistent-reversal",
            company.id,
            new Date().toISOString(),
            userId,
            "corrupt-operation",
            JSON.stringify({ targetEventId: opening.id, explanation: "Invalid target column" }),
            "different-target",
          ),
      ).toThrow();
    });
  });

  test("separate connections surface writer conflicts and can append after release", () => {
    withDatabase((first, path) => {
      const catalog = setupCatalog(first);
      const second = openDatabase(path);
      second.sqlite.run("PRAGMA busy_timeout = 10");
      try {
        first.sqlite.run("BEGIN IMMEDIATE");
        expect(() => withImmediateTransaction(second.sqlite, () => undefined)).toThrow(
          "database is locked",
        );
        first.sqlite.run("ROLLBACK");

        expect(() =>
          appendShareEvents(
            second,
            catalog.company.id,
            [
              openingDraft([
                {
                  shareholderId: catalog.alice.id,
                  shareClassId: catalog.classA.id,
                  ranges: [{ from: 1, to: 10 }],
                },
              ]),
            ],
            userId,
          ),
        ).not.toThrow();
      } finally {
        if (first.sqlite.inTransaction) first.sqlite.run("ROLLBACK");
        second.close();
      }
    });
  });
});
