import { describe, expect, test } from "bun:test";
import {
  createShareRegisterSnapshot,
  parseShareClass,
  parseShareholder,
  parseShareRegisterEvent,
  projectShareRegister,
  type ShareClass,
  type Shareholder,
  type ShareholderDetails,
} from "../../src/domain/share-register/index.ts";

const companyId = "company-1";
const initialDetails: ShareholderDetails = {
  legalName: "Alice Andersson",
  address: {
    lines: ["First Street 1"],
    postalCode: "111 11",
    locality: "Stockholm",
    countryCode: "SE",
  },
};

function details(legalName: string): ShareholderDetails {
  return {
    ...initialDetails,
    legalName,
    address: { ...initialDetails.address, lines: [`${legalName} Street 1`] },
  };
}

const shareholders: readonly Shareholder[] = [
  {
    id: "alice",
    companyId,
    kind: "INDIVIDUAL",
    identifierCountryCode: "SE",
    identifierScheme: "PERSONNUMMER",
    identifierValue: "8112189876",
    initialDetails,
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T12:00:00Z",
    registeredBy: "user-1",
  },
  {
    id: "bob",
    companyId,
    kind: "INDIVIDUAL",
    identifierCountryCode: "SE",
    identifierScheme: "PERSONNUMMER",
    identifierValue: "6408233234",
    initialDetails: details("Bob Berg"),
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T12:00:00Z",
    registeredBy: "user-1",
  },
  {
    id: "carol",
    companyId,
    kind: "LEGAL_ENTITY",
    identifierCountryCode: "SE",
    identifierScheme: "ORGANISATIONSNUMMER",
    identifierValue: "5560160680",
    initialDetails: details("Carol AB"),
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T12:00:00Z",
    registeredBy: "user-1",
  },
];

const shareClasses: readonly ShareClass[] = [
  {
    id: "class-a",
    companyId,
    name: "A",
    votesPerShare: "1",
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T12:00:00Z",
    registeredBy: "user-1",
  },
  {
    id: "class-b",
    companyId,
    name: "B",
    votesPerShare: "0.1",
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T12:00:00Z",
    registeredBy: "user-1",
  },
];

type EventOverrides = Readonly<{
  id?: string;
  sequence?: number;
  effectiveDate?: string;
  registeredAt?: string;
  operationId?: string;
  companyId?: string;
}>;

function eventFactory() {
  let nextSequence = 1;
  return (type: string, payload: unknown, overrides: EventOverrides = {}) => {
    const sequence = overrides.sequence ?? nextSequence;
    nextSequence = Math.max(nextSequence, sequence + 1);
    return {
      id: overrides.id ?? `event-${sequence}`,
      companyId: overrides.companyId ?? companyId,
      sequence,
      schemaVersion: 1,
      effectiveDate: overrides.effectiveDate ?? "2024-01-01",
      registeredAt:
        overrides.registeredAt ?? `2025-01-${String(sequence).padStart(2, "0")}T12:00:00Z`,
      registeredBy: "user-1",
      operationId: overrides.operationId ?? `operation-${sequence}`,
      type,
      payload,
    };
  };
}

function opening(
  makeEvent: ReturnType<typeof eventFactory>,
  ranges = [{ from: 1, to: 100 }],
  shareholderId = "alice",
  shareClassId = "class-a",
  overrides: EventOverrides = {},
) {
  return makeEvent(
    "OPENING_STATE_IMPORTED",
    {
      holdings: [{ shareholderId, shareClassId, ranges }],
      sourceType: "SHARE_REGISTER",
      importNote: "Verified against the signed register",
    },
    overrides,
  );
}

function snapshot(events: readonly unknown[], cutoffs: EventOverrides = {}) {
  return createShareRegisterSnapshot({
    companyId,
    shareholders,
    shareClasses,
    events,
    effectiveOn: cutoffs.effectiveDate,
    knownAt: cutoffs.registeredAt,
  });
}

describe("event boundary", () => {
  test("parses schema version 1 into deeply frozen, canonical events", () => {
    const makeEvent = eventFactory();
    const parsed = parseShareRegisterEvent(
      opening(makeEvent, [
        { from: 5, to: 5 },
        { from: 1, to: 4 },
      ]),
    );

    expect(parsed.schemaVersion).toBe(1);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.payload)).toBe(true);
    expect(parsed.type === "OPENING_STATE_IMPORTED" && parsed.payload.holdings[0]?.ranges).toEqual([
      { from: 1, to: 5 },
    ]);
  });

  test("allows an empty opening marker only for OCF transaction history", () => {
    const makeEvent = eventFactory();
    const payload = {
      holdings: [],
      sourceType: "OCF" as const,
      importNote: "Empty OCF history bootstrap",
    };
    const ocfBootstrap = makeEvent("OPENING_STATE_IMPORTED", payload);
    expect(parseShareRegisterEvent(ocfBootstrap).type).toBe("OPENING_STATE_IMPORTED");
    expect(() =>
      parseShareRegisterEvent(
        makeEvent("OPENING_STATE_IMPORTED", { ...payload, sourceType: "SHARE_REGISTER" }),
      ),
    ).toThrow("Only an OCF transaction-history bootstrap may have no holdings");
  });

  test("rejects invalid ranges, overlapping command ranges, schema versions, and decimal prices", () => {
    const makeEvent = eventFactory();
    expect(() => parseShareRegisterEvent(opening(makeEvent, [{ from: 0, to: 1 }]))).toThrow();
    expect(() =>
      parseShareRegisterEvent(
        opening(makeEvent, [
          { from: 1, to: 5 },
          { from: 5, to: 10 },
        ]),
      ),
    ).toThrow("Ranges must not overlap");

    const issue = makeEvent("SHARES_ISSUED", {
      shareholderId: "alice",
      shareClassId: "class-a",
      ranges: [{ from: 101, to: 102 }],
      subscriptionPrice: { amount: "1e3", currency: "SEK" },
    });
    expect(() => parseShareRegisterEvent(issue)).toThrow();
    expect(() => parseShareRegisterEvent({ ...issue, schemaVersion: 2 })).toThrow();
    expect(() =>
      parseShareRegisterEvent({ ...opening(makeEvent), sequence: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() =>
      parseShareRegisterEvent({ ...opening(makeEvent), registeredAt: "2025-02-30T12:00:00Z" }),
    ).toThrow();
  });
});

describe("catalog boundary and availability", () => {
  test("validates catalog identity, kind, details, votes, and registration history", () => {
    const [shareholder] = shareholders;
    const [shareClass] = shareClasses;
    if (!shareholder || !shareClass) throw new Error("Missing catalog fixtures");

    expect(() => parseShareholder({ ...shareholder, id: "" })).toThrow();
    expect(() => parseShareholder({ ...shareholder, kind: "TRUST" })).toThrow();
    expect(() =>
      parseShareholder({
        ...shareholder,
        initialDetails: { ...shareholder.initialDetails, legalName: "" },
      }),
    ).toThrow();
    expect(
      parseShareholder({
        ...shareholder,
        initialDetails: {
          ...shareholder.initialDetails,
          emailAddress: " alice@example.com ",
          phoneNumber: " +46 70 123 45 67 ",
        },
      }).initialDetails,
    ).toMatchObject({
      emailAddress: "alice@example.com",
      phoneNumber: "+46 70 123 45 67",
    });
    expect(() =>
      parseShareholder({
        ...shareholder,
        initialDetails: { ...shareholder.initialDetails, emailAddress: "not-an-email" },
      }),
    ).toThrow();
    expect(() =>
      parseShareholder({
        ...shareholder,
        initialDetails: { ...shareholder.initialDetails, phoneNumber: " " },
      }),
    ).toThrow();
    expect(() => parseShareholder({ ...shareholder, effectiveFrom: "2024-02-30" })).toThrow();
    expect(() => parseShareholder({ ...shareholder, registeredAt: "not-a-timestamp" })).toThrow();
    expect(() => parseShareholder({ ...shareholder, registeredBy: "" })).toThrow();

    expect(() => parseShareClass({ ...shareClass, id: "" })).toThrow();
    expect(() => parseShareClass({ ...shareClass, votesPerShare: "1e2" })).toThrow();
    expect(() => parseShareClass({ ...shareClass, effectiveFrom: "invalid" })).toThrow();
    expect(() =>
      parseShareClass({ ...shareClass, registeredAt: "2025-02-30T00:00:00Z" }),
    ).toThrow();
    expect(() => parseShareClass({ ...shareClass, registeredBy: "" })).toThrow();
  });

  test("filters catalogs by known time and snapshot details by both time axes", () => {
    const [baseShareholder] = shareholders;
    if (!baseShareholder) throw new Error("Missing shareholder fixture");
    const lateEffective: Shareholder = {
      ...baseShareholder,
      id: "late-effective",
      effectiveFrom: "2024-06-01",
    };
    const lateKnown: Shareholder = {
      ...baseShareholder,
      id: "late-known",
      registeredAt: "2025-06-01T12:00:00Z",
    };

    const result = createShareRegisterSnapshot({
      companyId,
      shareholders: [...shareholders, lateEffective, lateKnown],
      shareClasses,
      events: [],
      effectiveOn: "2024-05-31",
      knownAt: "2025-05-31T23:59:59Z",
    });

    expect(result.shareholderDetails.map(({ shareholderId }) => shareholderId)).not.toContain(
      "late-effective",
    );
    expect(result.shareholderDetails.map(({ shareholderId }) => shareholderId)).not.toContain(
      "late-known",
    );
  });

  test("requires shareholders and classes to be registered and effective at replay time", () => {
    const [baseShareholder] = shareholders;
    const [baseClass] = shareClasses;
    if (!baseShareholder || !baseClass) throw new Error("Missing catalog fixtures");

    const futureHolder: Shareholder = {
      ...baseShareholder,
      id: "future-holder",
      effectiveFrom: "2024-06-01",
      registeredAt: "2025-06-01T12:00:00Z",
    };
    const futureClass: ShareClass = {
      ...baseClass,
      id: "future-class",
      effectiveFrom: "2024-06-01",
      registeredAt: "2025-06-01T12:00:00Z",
    };
    const makeEvent = eventFactory();
    const holderOpening = opening(makeEvent, [{ from: 1, to: 10 }], futureHolder.id, baseClass.id);
    expect(() =>
      createShareRegisterSnapshot({
        companyId,
        shareholders: [...shareholders, futureHolder],
        shareClasses,
        events: [holderOpening],
        knownAt: "2025-05-31T23:59:59Z",
      }),
    ).toThrow("Unknown shareholder");

    const classOpening = opening(
      makeEvent,
      [{ from: 1, to: 10 }],
      baseShareholder.id,
      futureClass.id,
    );
    expect(() =>
      createShareRegisterSnapshot({
        companyId,
        shareholders,
        shareClasses: [...shareClasses, futureClass],
        events: [classOpening],
        knownAt: "2025-05-31T23:59:59Z",
      }),
    ).toThrow("Unknown share class");

    const knownButNotEffectiveHolder = { ...futureHolder, registeredAt: "2023-12-01T12:00:00Z" };
    expect(() =>
      createShareRegisterSnapshot({
        companyId,
        shareholders: [...shareholders, knownButNotEffectiveHolder],
        shareClasses,
        events: [holderOpening],
      }),
    ).toThrow("not effective");

    const knownButNotEffectiveClass = { ...futureClass, registeredAt: "2023-12-01T12:00:00Z" };
    expect(() =>
      createShareRegisterSnapshot({
        companyId,
        shareholders,
        shareClasses: [...shareClasses, knownButNotEffectiveClass],
        events: [classOpening],
      }),
    ).toThrow("not effective");
  });

  test("exports state details and reversed IDs as frozen arrays", () => {
    const makeEvent = eventFactory();
    const state = projectShareRegister({
      companyId,
      shareholders,
      shareClasses,
      events: [opening(makeEvent, [{ from: 1, to: 10 }])],
    });

    expect(Array.isArray(state.shareholderDetails)).toBe(true);
    expect(Array.isArray(state.reversedEventIds)).toBe(true);
    expect(Object.isFrozen(state.shareholderDetails)).toBe(true);
    expect(Object.isFrozen(state.reversedEventIds)).toBe(true);
  });
});

describe("ownership replay", () => {
  test("splits partial transfers and coalesces ranges after a full round trip", () => {
    const makeEvent = eventFactory();
    const events = [
      opening(makeEvent),
      makeEvent(
        "SHARES_TRANSFERRED",
        {
          transferorId: "alice",
          transfereeId: "bob",
          shareClassId: "class-a",
          ranges: [{ from: 21, to: 30 }],
          reason: "SALE",
        },
        { effectiveDate: "2024-02-01" },
      ),
    ];

    expect(snapshot(events).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 20 } },
      { shareholderId: "bob", shareClassId: "class-a", range: { from: 21, to: 30 } },
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 31, to: 100 } },
    ]);

    events.push(
      makeEvent(
        "SHARES_TRANSFERRED",
        {
          transferorId: "bob",
          transfereeId: "alice",
          shareClassId: "class-a",
          ranges: [{ from: 21, to: 30 }],
          reason: "GIFT",
        },
        { effectiveDate: "2024-03-01" },
      ),
    );
    expect(snapshot(events).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 100 } },
    ]);
  });

  test("supports sequential transfers, issuance, cancellation, and multiple classes", () => {
    const makeEvent = eventFactory();
    const events = [
      opening(makeEvent, [{ from: 1, to: 50 }]),
      makeEvent(
        "SHARES_TRANSFERRED",
        {
          transferorId: "alice",
          transfereeId: "bob",
          shareClassId: "class-a",
          ranges: [{ from: 1, to: 10 }],
          reason: "INHERITANCE",
        },
        { effectiveDate: "2024-02-01" },
      ),
      makeEvent(
        "SHARES_TRANSFERRED",
        {
          transferorId: "bob",
          transfereeId: "carol",
          shareClassId: "class-a",
          ranges: [{ from: 1, to: 5 }],
          reason: "DIVISION_OF_PROPERTY",
        },
        { effectiveDate: "2024-03-01" },
      ),
      makeEvent(
        "SHARES_ISSUED",
        {
          shareholderId: "bob",
          shareClassId: "class-b",
          ranges: [{ from: 51, to: 70 }],
          subscriptionPrice: { amount: "12.50", currency: "SEK" },
        },
        { effectiveDate: "2024-04-01" },
      ),
      makeEvent(
        "SHARES_CANCELLED",
        {
          shareholderId: "bob",
          shareClassId: "class-b",
          ranges: [{ from: 61, to: 70 }],
          reason: "REDEMPTION",
        },
        { effectiveDate: "2024-05-01" },
      ),
    ];

    const result = snapshot(events);
    expect(result.totalsByClass).toEqual([
      { shareClassId: "class-a", total: 50 },
      { shareClassId: "class-b", total: 10 },
    ]);
    expect(result.totalsByShareholder).toEqual([
      { shareholderId: "alice", total: 40 },
      { shareholderId: "bob", total: 15 },
      { shareholderId: "carol", total: 5 },
    ]);
    expect(result.holdings).toContainEqual({
      shareholderId: "carol",
      shareClassId: "class-a",
      range: { from: 1, to: 5 },
    });
    expect(
      projectShareRegister({ companyId, shareholders, shareClasses, events }).retiredRanges,
    ).toEqual([expect.objectContaining({ range: { from: 61, to: 70 }, source: "CANCELLATION" })]);
  });

  test("enforces ownership, class, company-wide numbering, and permanent retirement", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const invalidTransfer = makeEvent("SHARES_TRANSFERRED", {
      transferorId: "bob",
      transfereeId: "alice",
      shareClassId: "class-a",
      ranges: [{ from: 1, to: 2 }],
      reason: "OTHER",
      reasonNote: "Correction supplied by company",
    });
    expect(() => snapshot([open, invalidTransfer])).toThrow("not owned by bob");

    const issueOtherClass = makeEvent("SHARES_ISSUED", {
      shareholderId: "bob",
      shareClassId: "class-b",
      ranges: [{ from: 5, to: 12 }],
    });
    expect(() => snapshot([open, issueOtherClass])).toThrow("overlap active shares");

    const cancel = makeEvent("SHARES_CANCELLED", {
      shareholderId: "alice",
      shareClassId: "class-a",
      ranges: [{ from: 8, to: 10 }],
      reason: "CANCELLATION",
    });
    const reuse = makeEvent("SHARES_ISSUED", {
      shareholderId: "bob",
      shareClassId: "class-b",
      ranges: [{ from: 8, to: 10 }],
    });
    expect(() => snapshot([open, cancel, reuse])).toThrow("Retired share numbers");
  });

  test("rejects duplicate openings and cross-company references", () => {
    const makeEvent = eventFactory();
    expect(() => snapshot([opening(makeEvent), opening(makeEvent)])).toThrow(
      "opening state already exists",
    );
    expect(() =>
      snapshot([opening(makeEvent, [{ from: 1, to: 2 }], "missing-shareholder")]),
    ).toThrow("Unknown shareholder");
    expect(() =>
      createShareRegisterSnapshot({
        companyId,
        shareholders: shareholders.map((shareholder) => ({
          ...shareholder,
          companyId: "other-company",
        })),
        shareClasses,
        events: [],
      }),
    ).toThrow("belongs to another company");
  });
});

describe("capital and structural events", () => {
  test("records exact share capital and source activity before opening", () => {
    const makeEvent = eventFactory();
    const source = makeEvent("SOURCE_ACTIVITY_RECORDED", {
      sourceEventId: "bolagsverket-activity-1",
      category: "FORMATION",
      description: "Formation filing received",
      data: { filingNumber: "F-100", imported: true },
    });
    const capital = makeEvent("SHARE_CAPITAL_CHANGED", {
      after: { amount: "25000.00", currency: "SEK" },
      reason: "FORMATION",
      note: "Capital stated in formation documents",
    });
    const open = opening(makeEvent, [{ from: 1, to: 100 }]);
    const capitalIncrease = makeEvent("SHARE_CAPITAL_CHANGED", {
      before: { amount: "25000.00", currency: "SEK" },
      after: { amount: "50000.00", currency: "SEK" },
      reason: "ISSUE",
    });

    const state = projectShareRegister({
      companyId,
      shareholders,
      shareClasses,
      events: [source, capital, open, capitalIncrease],
    });
    const result = snapshot([source, capital, open, capitalIncrease]);

    expect(state.shareCapital?.amount as string).toBe("50000.00");
    expect(state.shareCapital?.currency).toBe("SEK");
    expect(result.shareCapital?.amount as string).toBe("50000.00");
    expect(result.shareCapital?.currency).toBe("SEK");
    expect(result.appliedEventIds).toEqual([source.id, capital.id, open.id, capitalIncrease.id]);
    expect(result.holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 100 } },
    ]);
  });

  test("validates exact capital, split, renumbering, and source payloads", () => {
    const makeEvent = eventFactory();
    expect(() =>
      parseShareRegisterEvent(
        makeEvent("SHARE_CAPITAL_CHANGED", {
          after: { amount: "2.5e4", currency: "SEK" },
          reason: "FORMATION",
        }),
      ),
    ).toThrow();
    expect(() => parseShareRegisterEvent(makeEvent("SHARES_SPLIT", { factor: 1 }))).toThrow();
    expect(() =>
      parseShareRegisterEvent(
        makeEvent("SHARES_RENUMBERED", {
          holdings: [],
          note: " ",
        }),
      ),
    ).toThrow();
    expect(() =>
      parseShareRegisterEvent(
        makeEvent("SOURCE_ACTIVITY_RECORDED", {
          sourceEventId: "source-1",
          category: "IMPORT",
          description: "Imported source activity",
          data: ["not", "a", "record"],
        }),
      ),
    ).toThrow();
  });

  test("splits active and retired ranges deterministically while preserving owners and classes", () => {
    const makeEvent = eventFactory();
    const open = makeEvent("OPENING_STATE_IMPORTED", {
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 1, to: 5 }] },
        { shareholderId: "bob", shareClassId: "class-b", ranges: [{ from: 6, to: 10 }] },
      ],
      sourceType: "SHARE_REGISTER",
      importNote: "Verified opening",
    });
    const cancellation = makeEvent("SHARES_CANCELLED", {
      shareholderId: "bob",
      shareClassId: "class-b",
      ranges: [{ from: 9, to: 10 }],
      reason: "CANCELLATION",
    });
    const split = makeEvent("SHARES_SPLIT", { factor: 2, note: "Two for one split" });

    const state = projectShareRegister({
      companyId,
      shareholders,
      shareClasses,
      events: [open, cancellation, split],
    });

    expect(state.holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } },
      { shareholderId: "bob", shareClassId: "class-b", range: { from: 11, to: 16 } },
    ]);
    expect(state.retiredRanges).toEqual([
      expect.objectContaining({ range: { from: 17, to: 20 }, source: "CANCELLATION" }),
    ]);
  });

  test("requires an opening for splits and rejects share-number overflow", () => {
    const makeEvent = eventFactory();
    expect(() => snapshot([makeEvent("SHARES_SPLIT", { factor: 2 })])).toThrow(
      "opening state is required",
    );

    const max = Number.MAX_SAFE_INTEGER;
    const open = opening(makeEvent, [{ from: max - 1, to: max }]);
    const split = makeEvent("SHARES_SPLIT", { factor: 2 });
    expect(() =>
      projectShareRegister({ companyId, shareholders, shareClasses, events: [open, split] }),
    ).toThrow("safe integer range");
  });

  test("renumbers complete holdings with per-owner/class conservation and clears retirements", () => {
    const makeEvent = eventFactory();
    const open = makeEvent("OPENING_STATE_IMPORTED", {
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 1, to: 4 }] },
        { shareholderId: "bob", shareClassId: "class-b", ranges: [{ from: 5, to: 8 }] },
      ],
      sourceType: "SHARE_REGISTER",
      importNote: "Verified opening",
    });
    const cancellation = makeEvent("SHARES_CANCELLED", {
      shareholderId: "alice",
      shareClassId: "class-a",
      ranges: [{ from: 4, to: 4 }],
      reason: "CANCELLATION",
    });
    const renumber = makeEvent("SHARES_RENUMBERED", {
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 101, to: 103 }] },
        { shareholderId: "bob", shareClassId: "class-b", ranges: [{ from: 201, to: 204 }] },
      ],
      note: "Replaced legacy numbering",
    });

    const state = projectShareRegister({
      companyId,
      shareholders,
      shareClasses,
      events: [open, cancellation, renumber],
    });
    expect(state.holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 101, to: 103 } },
      { shareholderId: "bob", shareClassId: "class-b", range: { from: 201, to: 204 } },
    ]);
    expect(state.retiredRanges).toEqual([]);
  });

  test("rejects overlapping or unconserved renumbering holdings", () => {
    const makeEvent = eventFactory();
    const open = makeEvent("OPENING_STATE_IMPORTED", {
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 1, to: 3 }] },
        { shareholderId: "bob", shareClassId: "class-a", ranges: [{ from: 4, to: 6 }] },
      ],
      sourceType: "SHARE_REGISTER",
      importNote: "Verified opening",
    });
    const overlapping = makeEvent("SHARES_RENUMBERED", {
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 10, to: 12 }] },
        { shareholderId: "bob", shareClassId: "class-a", ranges: [{ from: 12, to: 14 }] },
      ],
      note: "Invalid overlap",
    });
    expect(() => snapshot([open, overlapping])).toThrow("Share ranges overlap");

    const unconserved = {
      ...overlapping,
      id: "unconserved-renumbering",
      payload: {
        holdings: [
          { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 10, to: 11 }] },
          { shareholderId: "bob", shareClassId: "class-a", ranges: [{ from: 12, to: 15 }] },
        ],
        note: "Invalid allocation",
      },
    };
    expect(() => snapshot([open, unconserved])).toThrow("conserve the exact share count");
  });

  test("rejects reversals of all new event types with EVENT_TYPE_NOT_REVERSIBLE", () => {
    const targets: readonly [string, unknown][] = [
      [
        "SHARE_CAPITAL_CHANGED",
        { after: { amount: "25000", currency: "SEK" }, reason: "FORMATION" },
      ],
      ["SHARES_SPLIT", { factor: 2 }],
      [
        "SHARES_RENUMBERED",
        {
          holdings: [
            { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 1, to: 100 }] },
          ],
          note: "Confirmed existing numbering",
        },
      ],
      [
        "SOURCE_ACTIVITY_RECORDED",
        {
          sourceEventId: "source-1",
          category: "IMPORT",
          description: "Source activity",
        },
      ],
    ];

    for (const [type, payload] of targets) {
      const makeEvent = eventFactory();
      const open = opening(makeEvent);
      const target = makeEvent(type, payload, { id: "target" });
      const reversal = makeEvent("EVENT_REVERSED", {
        targetEventId: target.id,
        explanation: "Attempted reversal",
      });

      try {
        snapshot([open, target, reversal]);
        throw new Error(`Expected ${type} reversal to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: "EVENT_TYPE_NOT_REVERSIBLE" });
      }
    }
  });
});

describe("bitemporal and correction replay", () => {
  test("filters independently by effective and registration time", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }], "alice", "class-a", {
      registeredAt: "2025-01-01T12:00:00Z",
    });
    const transfer = makeEvent(
      "SHARES_TRANSFERRED",
      {
        transferorId: "alice",
        transfereeId: "bob",
        shareClassId: "class-a",
        ranges: [{ from: 1, to: 5 }],
        reason: "SALE",
      },
      { effectiveDate: "2024-06-01", registeredAt: "2025-08-01T12:00:00Z" },
    );

    expect(
      snapshot([transfer, open], {
        effectiveDate: "2024-12-31",
        registeredAt: "2025-07-31T23:59:59Z",
      }).holdings,
    ).toEqual([{ shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } }]);
    expect(
      snapshot([transfer, open], {
        effectiveDate: "2024-05-31",
        registeredAt: "2025-12-31T23:59:59Z",
      }).holdings,
    ).toEqual([{ shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } }]);
    expect(
      snapshot([transfer, open], {
        effectiveDate: "2024-12-31",
        registeredAt: "2025-12-31T23:59:59Z",
      }).holdings[0]?.shareholderId,
    ).toBe("bob");
  });

  test("sorts by effective date then sequence and invalidates a later timeline after backdating", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const transfer = makeEvent(
      "SHARES_TRANSFERRED",
      {
        transferorId: "alice",
        transfereeId: "bob",
        shareClassId: "class-a",
        ranges: [{ from: 1, to: 5 }],
        reason: "SALE",
      },
      { effectiveDate: "2024-06-01" },
    );
    const backdatedIssue = makeEvent(
      "SHARES_ISSUED",
      {
        shareholderId: "carol",
        shareClassId: "class-b",
        ranges: [{ from: 1, to: 5 }],
      },
      { effectiveDate: "2024-03-01" },
    );

    expect(() => snapshot([transfer, backdatedIssue, open])).toThrow("overlap active shares");
  });

  test("reverses a transfer only while the exact shares remain with the transferee", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const transfer = makeEvent(
      "SHARES_TRANSFERRED",
      {
        transferorId: "alice",
        transfereeId: "bob",
        shareClassId: "class-a",
        ranges: [{ from: 1, to: 5 }],
        reason: "SALE",
      },
      { id: "transfer", effectiveDate: "2024-02-01" },
    );
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "transfer", explanation: "Wrong recipient" },
      { effectiveDate: "2024-03-01", registeredAt: "2025-04-01T12:00:00Z" },
    );
    expect(snapshot([open, transfer, reversal]).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } },
    ]);

    const onwardTransfer = makeEvent(
      "SHARES_TRANSFERRED",
      {
        transferorId: "bob",
        transfereeId: "carol",
        shareClassId: "class-a",
        ranges: [{ from: 1, to: 2 }],
        reason: "GIFT",
      },
      { effectiveDate: "2024-02-15", sequence: 3 },
    );
    const lateReversal = {
      ...reversal,
      sequence: 4,
      id: "late-reversal",
      operationId: "operation-4",
    };
    expect(() => snapshot([open, transfer, onwardTransfer, lateReversal])).toThrow(
      "not owned by bob",
    );
  });

  test("restores cancellation ranges and rejects duplicate or reversal targets", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const cancellation = makeEvent(
      "SHARES_CANCELLED",
      {
        shareholderId: "alice",
        shareClassId: "class-a",
        ranges: [{ from: 8, to: 10 }],
        reason: "REDEMPTION",
      },
      { id: "cancellation", effectiveDate: "2024-02-01" },
    );
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "cancellation", explanation: "Decision was never adopted" },
      { id: "reversal", effectiveDate: "2024-03-01", registeredAt: "2025-04-01T12:00:00Z" },
    );
    expect(snapshot([open, cancellation, reversal]).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } },
    ]);

    const duplicate = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "cancellation", explanation: "Again" },
      { effectiveDate: "2024-04-01", registeredAt: "2025-05-01T12:00:00Z" },
    );
    expect(() => snapshot([open, cancellation, reversal, duplicate])).toThrow(
      "already been reversed",
    );
    const reverseReversal = {
      ...duplicate,
      payload: { targetEventId: "reversal", explanation: "Not supported" },
    };
    expect(() => snapshot([open, cancellation, reversal, reverseReversal])).toThrow(
      "Reversals cannot be reversed",
    );
  });

  test("rejects an issuance reversal after any issued shares moved onward", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const issue = makeEvent(
      "SHARES_ISSUED",
      { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 11, to: 20 }] },
      { id: "issue", effectiveDate: "2024-02-01" },
    );
    const transfer = makeEvent(
      "SHARES_TRANSFERRED",
      {
        transferorId: "alice",
        transfereeId: "bob",
        shareClassId: "class-a",
        ranges: [{ from: 11, to: 15 }],
        reason: "SALE",
      },
      { effectiveDate: "2024-03-01" },
    );
    const correctionOperation = "issue-correction";
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "issue", explanation: "Recipient was incorrect" },
      {
        effectiveDate: "2024-04-01",
        registeredAt: "2025-05-01T12:00:00Z",
        operationId: correctionOperation,
      },
    );
    expect(() => snapshot([transfer, open, reversal, issue])).toThrow("not owned by alice");
  });

  test("exactly reverses and replaces a fully owned issuance in the same operation", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const issue = makeEvent(
      "SHARES_ISSUED",
      { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 11, to: 20 }] },
      { id: "exact-issue", effectiveDate: "2024-02-01" },
    );
    const correctionOperation = "exact-issue-correction";
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "exact-issue", explanation: "Wrong recipient and class" },
      {
        effectiveDate: "2024-03-01",
        registeredAt: "2025-04-01T12:00:00Z",
        operationId: correctionOperation,
      },
    );
    const replacement = makeEvent(
      "SHARES_ISSUED",
      { shareholderId: "carol", shareClassId: "class-b", ranges: [{ from: 11, to: 20 }] },
      { effectiveDate: "2024-03-01", operationId: correctionOperation },
    );

    expect(snapshot([replacement, open, reversal, issue]).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } },
      { shareholderId: "carol", shareClassId: "class-b", range: { from: 11, to: 20 } },
    ]);
  });

  test("enforces reversal timing and correction-operation boundaries", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const issue = makeEvent(
      "SHARES_ISSUED",
      { shareholderId: "alice", shareClassId: "class-a", ranges: [{ from: 11, to: 20 }] },
      { id: "timed-issue", effectiveDate: "2024-03-01" },
    );
    const reversalBeforeTarget = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "timed-issue", explanation: "Too early" },
      { effectiveDate: "2024-02-01", registeredAt: "2025-04-01T12:00:00Z" },
    );
    expect(() => snapshot([open, issue, reversalBeforeTarget])).toThrow(
      "Reversal target has not been applied",
    );

    const reversalRegisteredTooEarly = {
      ...reversalBeforeTarget,
      id: "early-registration-reversal",
      effectiveDate: "2024-04-01",
      registeredAt: "2025-01-01T12:00:00Z",
    };
    expect(() => snapshot([open, issue, reversalRegisteredTooEarly])).toThrow(
      "registered after the reversal",
    );

    const sameMillisecondReversal = {
      ...reversalBeforeTarget,
      id: "same-millisecond-reversal",
      effectiveDate: "2024-04-01",
      registeredAt: issue.registeredAt,
    };
    expect(snapshot([open, issue, sameMillisecondReversal]).holdings).toEqual([
      { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 10 } },
    ]);

    const correctionOperation = "release-operation";
    const validReversal = {
      ...reversalBeforeTarget,
      id: "valid-issue-reversal",
      effectiveDate: "2024-04-01",
      operationId: correctionOperation,
    };
    const wrongOperationReplacement = makeEvent(
      "SHARES_ISSUED",
      { shareholderId: "bob", shareClassId: "class-b", ranges: [{ from: 11, to: 20 }] },
      { effectiveDate: "2024-04-01", operationId: "different-operation" },
    );
    expect(() => snapshot([open, issue, validReversal, wrongOperationReplacement])).toThrow(
      "exact correction replacement",
    );
  });

  test("changes and reverses full shareholder detail snapshots", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }]);
    const after = details("Alice Newname");
    const change = makeEvent(
      "SHAREHOLDER_DETAILS_CHANGED",
      { shareholderId: "alice", before: initialDetails, after },
      { id: "details-change", effectiveDate: "2024-02-01" },
    );
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "details-change", explanation: "Name change was filed in error" },
      { effectiveDate: "2024-03-01", registeredAt: "2025-04-01T12:00:00Z" },
    );
    expect(
      snapshot([open, change, reversal]).shareholderDetails.find(
        ({ shareholderId }) => shareholderId === "alice",
      )?.details,
    ).toEqual(initialDetails);

    const later = makeEvent(
      "SHAREHOLDER_DETAILS_CHANGED",
      { shareholderId: "alice", before: after, after: details("Alice Latest") },
      { effectiveDate: "2024-02-15", sequence: 3 },
    );
    const lateReversal = {
      ...reversal,
      id: "late-details-reversal",
      sequence: 4,
      operationId: "operation-4",
    };
    expect(() => snapshot([open, change, later, lateReversal])).toThrow(
      "details changed after the target",
    );

    const changedIdentifier = makeEvent(
      "SHAREHOLDER_DETAILS_CHANGED",
      {
        shareholderId: "alice",
        before: initialDetails,
        after: { ...initialDetails, identifierValue: "changed" },
      },
      { effectiveDate: "2024-02-01" },
    );
    expect(() => snapshot([open, changedIdentifier])).toThrow();
  });

  test("allows only an immediate atomic exact opening replacement", () => {
    const makeEvent = eventFactory();
    const open = opening(makeEvent, [{ from: 1, to: 10 }], "alice", "class-a", {
      id: "opening",
      operationId: "opening-import",
      registeredAt: "2025-01-01T12:00:00Z",
    });
    const correctionOperation = "opening-correction";
    const reversal = makeEvent(
      "EVENT_REVERSED",
      { targetEventId: "opening", explanation: "Opening owner was wrong" },
      {
        effectiveDate: "2024-01-01",
        registeredAt: "2025-02-01T12:00:00Z",
        operationId: correctionOperation,
      },
    );
    const replacement = opening(makeEvent, [{ from: 1, to: 10 }], "bob", "class-b", {
      effectiveDate: "2024-01-01",
      operationId: correctionOperation,
      registeredAt: "2025-02-01T12:00:01Z",
    });

    expect(snapshot([replacement, reversal, open]).holdings).toEqual([
      { shareholderId: "bob", shareClassId: "class-b", range: { from: 1, to: 10 } },
    ]);
    expect(() => snapshot([open, reversal])).toThrow("exact replacement");
    expect(() =>
      snapshot([
        open,
        reversal,
        {
          ...replacement,
          payload: {
            holdings: [],
            sourceType: "SHARE_REGISTER",
            importNote: "Invalid empty replacement",
          },
        },
      ]),
    ).toThrow();
  });
});
