import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import {
  FortnoxParseError,
  parseFortnoxDetailedRegister,
  parseFortnoxEventsHtml,
  parseFortnoxExport,
  parseFortnoxImport,
  parseFortnoxOwnerOverview,
} from "../../src/modules/fortnox-import/index.ts";

const detailedRegisterText = `
Aktiebok
Exempelbolaget AB
000000-0000
2026-08-29
Utskrift från digital aktiebok.

Aktiepost 1
Aktienummer
1 - 2
Antal aktier
2 (A-aktie)
Antal röster
2
Infört i aktieboken
2022-01-01
Postens kapitalbelopp
20,00 kr
Kvotvärde
10,000 kr / aktie
Samtyckesförbehåll
Nej
Förköpsförbehåll
Nej
Hembud
Nej
Aktieägare
100000-0001
Testägare Alfa
Testgatan 1
111 11 Teststad
Inlösenförbehåll
Nej
Omvandlingsförbehåll
Nej
Förmyndare / god man
Nej
Aktiebrev utgivet
Nej
Tidigare ägare
Namn Införd
Testägare Före (100000-0099) 2020-01-01

Aktiepost 2
Aktienummer
3 - 3
Antal aktier
1 (A-aktie)
Antal röster
1
Infört i aktieboken
2023-02-02
Postens kapitalbelopp
10 kr
Kvotvärde
10,000 kr / aktie
Samtyckesförbehåll
Nej
Förköpsförbehåll
Nej
Hembud
Nej
Aktieägare
100000-0002
Testägare Beta
Provvägen 2
22222 Provort
Inlösenförbehåll
Nej
Omvandlingsförbehåll
Nej
Förmyndare / god man
Nej
Aktiebrev utgivet
Nej
Inga tidigare ägare.
`;

const ownerOverviewText = `
Aktieägaröversikt
Exempelbolaget AB
000000-0000
2026-08-29

Aktieägaröversikt för Exempelbolaget AB (000000-0000), 2026-08-29
Ägare A-aktier Ägarandel Röster
Testägare Alfa (100000-0001) 2 66,67 % 2 (ca 67 %)
Testägare Beta (100000-0002) 1 33,33 % 1 (ca
33 %)
Summa 3 3
`;

function eventMarkup(sourceId: string, date: string, type: string, description: string): string {
  return `
    <a href="">
      <ul id="${sourceId}" class="cards bg-white d-md-none">
        <li><p class="title"><strong>Datum</strong></p><p class="title-value"><strong>${date}</strong></p></li>
        <li><p class="title"><strong>Typ</strong></p><p class="title-value"><strong>${type}</strong></p></li>
        <li><p class="title"><strong>Beskrivning</strong></p><p class="title-value"><strong>${description}</strong></p></li>
      </ul>
    </a>
    <a href="">
      <div id="${sourceId}" class="desktop-view-value clickable row d-none d-md-flex">
        <p><strong>${date}</strong></p><p><strong>${type}</strong></p><p><strong>${description}</strong></p>
      </div>
    </a>`;
}

const eventsHtml = `<!doctype html><html><body>
  ${eventMarkup("101", "2022-01-01", "Transaktion", "Testbolag &Ouml; k&ouml;pte 2&nbsp;aktier")}
  ${eventMarkup("100", "2020-01-01", "Uppl&auml;ggning", "Aktieboken skapades")}
</body></html>`;

describe("Fortnox import parser", () => {
  test("parses the column-preserving text layout produced by pdftotext", () => {
    const detailed = parseFortnoxDetailedRegister(`
      Aktiebok

        Kolumnexempel AB
        000000-0000

        2026-08-29

      Aktiepost 1

      Aktienummer             Antal aktier       Antal röster
      1 - 2                   2 (B-aktie)        4
      Infört i aktieboken     Postens kapitalbelopp   Kvotvärde
      2024-01-01              2 000,50 kr             1 000,250 kr / aktie
      Aktieägare              Inlösenförbehåll   Omvandlingsförbehåll
      100000-0003             Nej                Nej
      Testägare Kolumn
      Kolumngatan 3           Förmyndare / god man    Aktiebrev utgivet
      333 33 Kolumnort        Nej                     Nej

      Tidigare ägare
      Namn                                         Införd
      Testägare Historik (100000-0098)             2020-01-01
    `);
    const overview = parseFortnoxOwnerOverview(`
      Aktieägaröversikt för Kolumnexempel AB (000000-0000), 2026-08-29
      Ägare                                      B-aktier   Ägarandel   Röster
      Testägare Kolumn (100000-0003)             2          100 %       4 (ca
                                                                            100 %)
      Summa                                      2                      4
    `);

    expect(detailed.posts[0]?.capitalAmount).toBe("2000.50");
    expect(detailed.posts[0]?.owner.address).toEqual(["Kolumngatan 3", "333 33 Kolumnort"]);
    expect(overview).toMatchObject({ shareClass: "B-aktier", totalCount: 2, totalVotes: "4" });
  });

  test("parses wholly owned overview rows without an approximate vote suffix", () => {
    const overview = parseFortnoxOwnerOverview(`
      Aktieägaröversikt för Helägt AB (000000-0000), 2026-08-29
      Ägare Stamaktier Ägarandel Röster
      Moderbolaget AB (100000-0003) 1000 100 % 1000
      Summa 1000 1000
    `);

    expect(overview.owners[0]).toMatchObject({
      ownershipPercentage: "100",
      approximateVotePercentage: "100",
    });
  });

  test("reconciles unhyphenated singular and plural share-class labels", () => {
    const parsed = parseFortnoxImport({
      detailedRegisterText: detailedRegisterText.replaceAll("A-aktie", "Stamaktie"),
      ownerOverviewText: ownerOverviewText.replace("A-aktier", "Stamaktier"),
      eventsHtml,
    });

    expect(parsed.analysis.shareClass).toBe("Stam");
  });

  test("reconciles owner names wrapped onto address lines", () => {
    const parsed = parseFortnoxImport({
      detailedRegisterText: detailedRegisterText.replace(
        "Testägare Alfa\nTestgatan 1",
        "Testägare\nAlfa\nTestgatan 1",
      ),
      ownerOverviewText,
      eventsHtml,
    });

    expect(parsed.posts[0]?.owner).toEqual({
      identifier: "100000-0001",
      name: "Testägare Alfa",
      address: ["Testgatan 1", "111 11 Teststad"],
    });
  });

  test("parses and reconciles detailed, overview, and deduplicated event sources", () => {
    const parsed = parseFortnoxExport({
      detailedRegisterText,
      ownerOverviewText,
      eventsHtml,
    });

    expect(parsed.company).toEqual({
      legalName: "Exempelbolaget AB",
      organizationNumber: "000000-0000",
      exportDate: "2026-08-29",
    });
    expect(parsed.posts).toHaveLength(2);
    expect(parsed.posts[0]).toEqual({
      postNumber: 1,
      range: { from: 1, to: 2 },
      count: 2,
      shareClass: "A-aktie",
      votes: "2",
      enteredDate: "2022-01-01",
      capitalAmount: "20.00",
      quotientValue: "10.000",
      owner: {
        identifier: "100000-0001",
        name: "Testägare Alfa",
        address: ["Testgatan 1", "111 11 Teststad"],
      },
      previousOwners: [
        {
          identifier: "100000-0099",
          name: "Testägare Före",
          enteredDate: "2020-01-01",
        },
      ],
    });
    expect(parsed.overview.owners[1]).toEqual({
      identifier: "100000-0002",
      name: "Testägare Beta",
      count: 1,
      ownershipPercentage: "33.33",
      votes: "1",
      approximateVotePercentage: "33",
    });
    expect(parsed.analysis).toEqual({
      totalShares: 3,
      totalVotes: "3",
      shareClass: "A",
      checks: {
        rangeCounts: true,
        nonOverlappingRanges: true,
        contiguousRanges: true,
        votes: true,
        overviewTotals: true,
        overviewOwners: true,
        oneShareClass: true,
      },
      warnings: [],
    });
  });

  test("decodes descriptions and retains numeric source IDs while deduplicating event views", () => {
    expect(parseFortnoxEventsHtml(eventsHtml)).toEqual([
      {
        sourceId: "101",
        date: "2022-01-01",
        type: "Transaktion",
        description: "Testbolag Ö köpte 2 aktier",
      },
      {
        sourceId: "100",
        date: "2020-01-01",
        type: "Uppläggning",
        description: "Aktieboken skapades",
      },
    ]);
  });

  test("rejects malformed post ranges instead of omitting them", () => {
    expect(() =>
      parseFortnoxImport({
        detailedRegisterText: detailedRegisterText.replace("1 - 2", "1 - 3"),
        ownerOverviewText,
        eventsHtml,
      }),
    ).toThrow(FortnoxParseError);
  });

  test("rejects overview owners that disagree with detailed posts", () => {
    expect(() =>
      parseFortnoxImport({
        detailedRegisterText,
        ownerOverviewText: ownerOverviewText.replace(
          "Testägare Alfa (100000-0001) 2",
          "Testägare Alfa (100000-0001) 1",
        ),
        eventsHtml,
      }),
    ).toThrow(/does not match the detailed posts/);
  });

  test("rejects disagreeing mobile and desktop event copies", () => {
    const inconsistent = eventMarkup(
      "101",
      "2022-01-01",
      "Transaktion",
      "Testbolag k&ouml;pte 2 aktier",
    ).replace(/Testbolag k&ouml;pte 2 aktier(?=<\/strong><\/p>\s*<\/div>)/, "Annan text");
    expect(() => parseFortnoxEventsHtml(inconsistent)).toThrow(
      /Mobile and desktop event 101 disagree/,
    );
  });

  test("extracts visible text from tags with quoted angle brackets", () => {
    const [event] = parseFortnoxEventsHtml(
      eventMarkup(
        "101",
        "2022-01-01",
        "Transaktion",
        '<span title="<ignored>">Testbolag</span> k&ouml;pte 2 aktier',
      ),
    );

    expect(event?.description).toBe("Testbolag köpte 2 aktier");
  });

  test("collects warnings for unsupported and source-inconsistent history", () => {
    const parsed = parseFortnoxImport({
      detailedRegisterText: detailedRegisterText.replace(
        "2020-01-01\n\nAktiepost 2",
        "2024-01-01\n\nAktiepost 2",
      ),
      ownerOverviewText,
      eventsHtml: eventMarkup("77", "2020-01-01", "Split", "2 nya aktier, split kvot 2:1"),
    });

    expect(parsed.analysis.warnings.map((warning) => warning.code)).toEqual([
      "SOURCE_HISTORY_ORDER",
      "UNSUPPORTED_EVENT_TYPE",
    ]);
    expect(parsed.analysis.warnings[1]?.sourceId).toBe("77");
  });

  test("reports invalid parser input as a ZodError", () => {
    expect(() =>
      parseFortnoxImport({ detailedRegisterText: "", ownerOverviewText, eventsHtml }),
    ).toThrow(ZodError);
  });
});
