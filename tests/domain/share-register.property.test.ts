import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  countRanges,
  createShareRegisterSnapshot,
  type Holding,
  normalizeRanges,
  rangesOverlap,
  type ShareRange,
  subtractRanges,
} from "../../src/domain/share-register/index.ts";

function booleanRuns(values: readonly boolean[]): ShareRange[] {
  const ranges: ShareRange[] = [];
  let start: number | undefined;
  for (const [index, selected] of values.entries()) {
    const shareNumber = index + 1;
    if (selected && start === undefined) start = shareNumber;
    if (!selected && start !== undefined) {
      ranges.push({ from: start, to: shareNumber - 1 });
      start = undefined;
    }
  }
  if (start !== undefined) ranges.push({ from: start, to: values.length });
  return ranges;
}

function assertNonOverlapping(holdings: readonly Holding[]): void {
  for (const [index, holding] of holdings.entries()) {
    for (const other of holdings.slice(index + 1)) {
      expect(rangesOverlap(holding.range, other.range)).toBe(false);
    }
  }
}

function shareholderFixture(id: string, legalName: string, addressLine: string) {
  return {
    id,
    companyId: "company",
    kind: "INDIVIDUAL",
    identifierCountryCode: "SE",
    identifierScheme: "PERSONNUMMER",
    identifierValue: id === "alice" ? "8112189876" : "6408233234",
    initialDetails: {
      legalName,
      address: {
        lines: [addressLine],
        postalCode: id === "alice" ? "1" : "2",
        locality: "Town",
        countryCode: "SE",
      },
    },
    effectiveFrom: "2024-01-01",
    registeredAt: "2023-12-01T00:00:00Z",
    registeredBy: "user",
  } as const;
}

function openingEvent(shareCount: number) {
  return {
    id: "opening",
    companyId: "company",
    sequence: 1,
    schemaVersion: 1,
    effectiveDate: "2024-01-01",
    registeredAt: "2025-01-01T00:00:00Z",
    registeredBy: "user",
    operationId: "opening-operation",
    type: "OPENING_STATE_IMPORTED",
    payload: {
      holdings: [
        {
          shareholderId: "alice",
          shareClassId: "ordinary",
          ranges: [{ from: 1, to: shareCount }],
        },
      ],
      sourceType: "SHARE_REGISTER",
      importNote: "Property fixture",
    },
  } as const;
}

function transferEvent(ranges: readonly ShareRange[]) {
  return {
    id: "transfer",
    companyId: "company",
    sequence: 2,
    schemaVersion: 1,
    effectiveDate: "2024-02-01",
    registeredAt: "2025-01-02T00:00:00Z",
    registeredBy: "user",
    operationId: "transfer-operation",
    type: "SHARES_TRANSFERRED",
    payload: {
      transferorId: "alice",
      transfereeId: "bob",
      shareClassId: "ordinary",
      ranges,
      reason: "SALE",
    },
  } as const;
}

function generatedTransferFixture(selection: readonly boolean[]) {
  const selectedRanges = booleanRuns(selection);
  return {
    companyId: "company",
    shareholders: [
      shareholderFixture("alice", "Alice", "One"),
      shareholderFixture("bob", "Bob", "Two"),
    ],
    shareClasses: [
      {
        id: "ordinary",
        companyId: "company",
        name: "Ordinary",
        votesPerShare: "1",
        effectiveFrom: "2024-01-01",
        registeredAt: "2023-12-01T00:00:00Z",
        registeredBy: "user",
      },
    ],
    events: [
      openingEvent(selection.length),
      ...(selectedRanges.length > 0 ? [transferEvent(selectedRanges)] : []),
    ],
  };
}

test("generated transfers preserve total count and non-overlap", () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }), (selection) => {
      const snapshot = createShareRegisterSnapshot(generatedTransferFixture(selection));

      assertNonOverlapping(snapshot.holdings);
      expect(countRanges(snapshot.holdings.map(({ range }) => range))).toBe(selection.length);
      expect(snapshot.totalsByClass[0]?.total).toBe(selection.length);
    }),
    { numRuns: 200 },
  );
});

test("range subtraction conserves the partition count", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 10_000 }),
      fc.integer({ min: 1, max: 10_000 }),
      fc.integer({ min: 1, max: 10_000 }),
      (first, second, third) => {
        const endpoints = [first, second, third].sort((left, right) => left - right);
        const from = Math.min(first, second, third);
        const middle = endpoints.at(1) ?? from;
        const to = Math.max(first, second, third);
        const source = [{ from, to }];
        const removed = [{ from, to: middle }];
        const remainder = subtractRanges(source, removed);

        expect(countRanges(normalizeRanges([...removed, ...remainder]))).toBe(countRanges(source));
      },
    ),
    { numRuns: 500 },
  );
});
