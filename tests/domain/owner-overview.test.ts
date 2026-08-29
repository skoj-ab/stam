import { describe, expect, test } from "bun:test";
import { createOwnerOverview } from "../../src/domain/share-register/index.ts";

describe("owner overview", () => {
  test("calculates shares and voting power across share classes with exact decimals", () => {
    const overview = createOwnerOverview({
      holdings: [
        { shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 2 } },
        { shareholderId: "alice", shareClassId: "class-b", range: { from: 3, to: 5 } },
        { shareholderId: "bob", shareClassId: "class-b", range: { from: 6, to: 10 } },
      ],
      totalsByShareholder: [
        { shareholderId: "alice", total: 5 },
        { shareholderId: "bob", total: 5 },
      ],
      shareClasses: [
        { id: "class-a", votesPerShare: "1" },
        { id: "class-b", votesPerShare: "0.1" },
      ],
    });

    expect(overview).toEqual({
      owners: [
        {
          shareholderId: "alice",
          totalShares: 5,
          ownershipPercentage: "50",
          totalVotes: "2.3",
          votingPercentage: "82.14",
        },
        {
          shareholderId: "bob",
          totalShares: 5,
          ownershipPercentage: "50",
          totalVotes: "0.5",
          votingPercentage: "17.86",
        },
      ],
      totalShares: 10,
      totalVotes: "2.8",
    });
  });

  test("leaves voting percentages unavailable when the register has no voting power", () => {
    const overview = createOwnerOverview({
      holdings: [{ shareholderId: "alice", shareClassId: "class-a", range: { from: 1, to: 3 } }],
      totalsByShareholder: [{ shareholderId: "alice", total: 3 }],
      shareClasses: [{ id: "class-a", votesPerShare: "0" }],
    });

    expect(overview.totalVotes).toBe("0");
    expect(overview.owners[0]).toEqual({
      shareholderId: "alice",
      totalShares: 3,
      ownershipPercentage: "100",
      totalVotes: "0",
    });
  });

  test("rejects holdings whose share class is unavailable", () => {
    expect(() =>
      createOwnerOverview({
        holdings: [{ shareholderId: "alice", shareClassId: "missing", range: { from: 1, to: 1 } }],
        totalsByShareholder: [{ shareholderId: "alice", total: 1 }],
        shareClasses: [],
      }),
    ).toThrow("Missing share class missing");
  });
});
