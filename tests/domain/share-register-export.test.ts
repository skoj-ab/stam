import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  renderSwedishShareRegisterHtml,
  type ShareRegisterExportSnapshot,
} from "../../src/modules/share-register-exports/index.ts";
import {
  createTypstShareRegisterData,
  renderSwedishShareRegisterPdf,
} from "../../src/modules/share-register-exports/pdf.ts";

const snapshot: ShareRegisterExportSnapshot = {
  schemaVersion: 1,
  companyId: "company-1",
  company: {
    id: "company-1",
    legalName: "Example <script>alert(1)</script> AB",
    registrationCountry: "SE",
    registrationScheme: "ORGANISATIONSNUMMER",
    registrationValue: "5560160680",
  },
  effectiveOn: "2024-12-31",
  knownAt: "2025-01-01T12:00:00.000Z",
  generatedAt: "2025-01-01T12:00:00.000Z",
  holdings: [
    {
      shareholderId: "shareholder-1",
      shareClassId: "class-a",
      range: { from: 1, to: 100 },
    },
  ],
  shareholderDetails: [
    {
      shareholderId: "shareholder-1",
      details: {
        legalName: "Alice & Andersson",
        emailAddress: "alice@example.se",
        phoneNumber: "+46 70 123 45 67",
        address: {
          lines: ["Exempelvägen 1"],
          postalCode: "111 11",
          locality: "Stockholm",
          countryCode: "SE",
        },
      },
    },
  ],
  shareholderCatalog: [
    {
      id: "shareholder-1",
      kind: "INDIVIDUAL",
      identifierCountryCode: "SE",
      identifierScheme: "PERSONNUMMER",
      identifierValue: "8112189876",
    },
  ],
  shareClasses: [
    {
      id: "class-a",
      companyId: "company-1",
      name: "A",
      votesPerShare: "1",
      effectiveFrom: "2024-01-01",
      registeredAt: "2024-01-01T12:00:00.000Z",
      registeredBy: "user-1",
    },
  ],
  totalsByClass: [{ shareClassId: "class-a", total: 100 }],
  totalsByShareholder: [{ shareholderId: "shareholder-1", total: 100 }],
  appliedEventIds: ["event-1"],
  lastAppliedSequence: 1,
};

function mixedVotingSnapshot(): ShareRegisterExportSnapshot {
  const aliceDetails = snapshot.shareholderDetails.at(0)?.details;
  if (!aliceDetails) throw new Error("Expected Alice's shareholder details in the fixture");
  const classA = snapshot.shareClasses.at(0);
  if (!classA) throw new Error("Expected class A in the fixture");

  return {
    ...snapshot,
    holdings: [
      {
        shareholderId: "shareholder-1",
        shareClassId: "class-a",
        range: { from: 1, to: 2 },
      },
      {
        shareholderId: "shareholder-1",
        shareClassId: "class-b",
        range: { from: 3, to: 5 },
      },
      {
        shareholderId: "shareholder-2",
        shareClassId: "class-b",
        range: { from: 6, to: 10 },
      },
    ],
    totalsByShareholder: [
      { shareholderId: "shareholder-1", total: 5 },
      { shareholderId: "shareholder-2", total: 5 },
    ],
    totalsByClass: [
      { shareClassId: "class-a", total: 2 },
      { shareClassId: "class-b", total: 8 },
    ],
    shareClasses: [
      ...snapshot.shareClasses,
      { ...classA, id: "class-b", name: "B", votesPerShare: "0.1" },
    ],
    shareholderDetails: [
      ...snapshot.shareholderDetails,
      {
        shareholderId: "shareholder-2",
        details: {
          ...aliceDetails,
          legalName: "Bob Berg",
          emailAddress: "bob@example.se",
          phoneNumber: "+46 70 765 43 21",
        },
      },
    ],
    shareholderCatalog: [
      ...snapshot.shareholderCatalog,
      {
        id: "shareholder-2",
        kind: "INDIVIDUAL",
        identifierCountryCode: "SE",
        identifierScheme: "PERSONNUMMER",
        identifierValue: "6408233234",
      },
    ],
  };
}

describe("Swedish share-register exports", () => {
  test("renders a self-contained, escaped, cutoff-specific document", () => {
    const html = renderSwedishShareRegisterHtml(snapshot);
    expect(html).toContain("Aktiebok för Example &lt;script&gt;alert(1)&lt;/script&gt; AB");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Alice &amp; Andersson");
    expect(html).toContain("Organisationsnummer: 556016-0680");
    expect(html).toContain("1–100");
    expect(html).toContain("2024-12-31");
    expect(html).toContain("utfärdade aktiebrev");
  });

  test("renders a snapshot-driven PDF without external state", async () => {
    const pdf = await renderSwedishShareRegisterPdf(snapshot);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    const firstPage = (await PDFDocument.load(pdf)).getPage(0);
    expect(firstPage.getWidth()).toBeLessThan(firstPage.getHeight());
  });

  test("formats the footer timestamp in the explicit server timezone", () => {
    const data = createTypstShareRegisterData(snapshot, "Europe/Stockholm");
    expect(data.generatedAtLocal).toBe("2025-01-01 13:00:00 · Europe/Stockholm (UTC+01:00)");
    expect(data.company.registrationValue).toBe("556016-0680");
    expect(data).not.toHaveProperty("knownAt");
  });

  test("summarizes total ownership across share classes in the PDF", () => {
    const data = createTypstShareRegisterData(mixedVotingSnapshot());

    expect(data.owners).toEqual([
      {
        legalName: "Alice & Andersson",
        identifier: "811218-9876",
        address: "Exempelvägen 1, 111 11 Stockholm, SE",
        emailAddress: "alice@example.se",
        phoneNumber: "+46 70 123 45 67",
        totalShares: "5",
        ownershipPercentage: "50 %",
        totalVotes: "2,3",
        votingPercentage: "82,14 %",
      },
      {
        legalName: "Bob Berg",
        identifier: "640823-3234",
        address: "Exempelvägen 1, 111 11 Stockholm, SE",
        emailAddress: "bob@example.se",
        phoneNumber: "+46 70 765 43 21",
        totalShares: "5",
        ownershipPercentage: "50 %",
        totalVotes: "0,5",
        votingPercentage: "17,86 %",
      },
    ]);
    expect(data.ownerTotal).toEqual({ totalShares: "10", totalVotes: "2,8" });
    expect(data.holdings[0]).not.toHaveProperty("address");
    expect(data).not.toHaveProperty("summary");
  });

  test("treats persisted text as data and renders an empty register", async () => {
    const pdf = await renderSwedishShareRegisterPdf({
      ...snapshot,
      company: {
        ...snapshot.company,
        legalName: 'Example #panic("must not execute") AB',
      },
      holdings: [],
      totalsByClass: [],
      totalsByShareholder: [],
    });

    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  test("paginates long registers", async () => {
    const holdings = Array.from({ length: 30 }, (_, index) => ({
      shareholderId: "shareholder-1",
      shareClassId: "class-a",
      range: { from: index + 1, to: index + 1 },
    }));
    const pdf = await renderSwedishShareRegisterPdf({ ...snapshot, holdings });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });
});
