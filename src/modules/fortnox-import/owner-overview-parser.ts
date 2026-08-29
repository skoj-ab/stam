import {
  companySchema,
  type FortnoxCompany,
  type FortnoxOwnerOverview,
  FortnoxParseError,
  overviewOwnerSchema,
  ownerOverviewSchema,
} from "./parser-model.ts";
import { SourceDocumentParser } from "./source-document-parser.ts";

type OverviewTable = Readonly<{
  sourceShareClass: string;
  ownerRowsSource: string;
  totalRow: string;
}>;
type OverviewOwnerRow = Readonly<{ source: string; rowNumber: number }>;
type OverviewTotals = Readonly<{ count: number; votes: string }>;

class OwnerOverviewParser extends SourceDocumentParser<FortnoxOwnerOverview> {
  private readonly text = this.normalizedText().replace(/\(ca\s*\n\s*/g, "(ca ");

  parse(): FortnoxOwnerOverview {
    const table = this.parseTable();
    const rows = table.ownerRowsSource
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (rows.length === 0) throw new FortnoxParseError("The owner overview has no owners.");

    const totals = this.parseTotals(table);
    return ownerOverviewSchema.parse({
      company: this.parseCompany(),
      shareClass: table.sourceShareClass,
      owners: rows.map((source, index) => this.parseOwnerRow({ source, rowNumber: index + 1 })),
      totalCount: totals.count,
      totalVotes: totals.votes,
    });
  }

  private parseCompany(): FortnoxCompany {
    const match = this.requiredMatch({
      source: this.text,
      pattern: /(?:^|\n)\s*Aktieägaröversikt för (.+?) \(([^()\n]+)\), (\d{4}-\d{2}-\d{2})(?:\n|$)/,
      description: "owner overview company header",
    });
    return companySchema.parse({
      legalName: this.requiredCapture({
        match,
        group: 1,
        description: "overview company legal name",
      }),
      organizationNumber: this.requiredCapture({
        match,
        group: 2,
        description: "overview organization number",
      }),
      exportDate: this.requiredCapture({
        match,
        group: 3,
        description: "overview export date",
      }),
    });
  }

  private parseTable(): OverviewTable {
    const header = this.requiredMatch({
      source: this.text,
      pattern: /(?:^|\n)\s*Ägare\s+(.+?)\s+Ägarandel\s+Röster(?:\n|$)/,
      description: "owner overview table header",
    });
    const headerEnd = (header.index ?? 0) + header[0].length;
    const rowsAndTotal = this.text.slice(headerEnd);
    const totalMatch = this.requiredMatch({
      source: rowsAndTotal,
      pattern: /(?:^|\n)\s*(Summa[^\n]+)(?:\n|$)/,
      description: "owner overview total",
    });
    const totalStart = totalMatch.index ?? 0;
    return {
      sourceShareClass: this.requiredCapture({
        match: header,
        group: 1,
        description: "overview share class",
      }),
      ownerRowsSource: rowsAndTotal.slice(0, totalStart),
      totalRow: this.requiredCapture({
        match: totalMatch,
        group: 1,
        description: "owner overview total",
      }),
    };
  }

  private parseTotals({ totalRow }: OverviewTable): OverviewTotals {
    const columns = this.splitColumns({ source: totalRow });
    const sequential = totalRow.match(/^Summa\s+(\d+)\s+([\d,.]+)$/);
    const countSource = columns.length === 3 ? columns[1] : sequential?.[1];
    const votesSource = columns.length === 3 ? columns[2] : sequential?.[2];
    if (!countSource || !votesSource) {
      throw new FortnoxParseError("Missing or malformed owner overview total.");
    }
    return {
      count: this.parsePositiveInteger({
        source: countSource,
        description: "overview total count",
      }),
      votes: this.normalizeDecimal({
        source: votesSource,
        description: "overview total votes",
      }),
    };
  }

  private parseOwnerRow({ source, rowNumber }: OverviewOwnerRow) {
    const match = this.requiredMatch({
      source,
      pattern:
        /^(.+?)\s+\(([^()]+)\)\s+([\d\s]+)\s+([\d\s,.]+)\s*%\s+([\d\s,.]+)(?:\s+\(ca\s+([\d\s,.]+)\s*%\))?$/,
      description: `owner overview row ${rowNumber}`,
    });
    const ownershipPercentage = this.normalizeDecimal({
      source: this.requiredCapture({
        match,
        group: 4,
        description: "ownership percentage",
      }),
      description: `ownership percentage in row ${rowNumber}`,
    });
    const approximateVotePercentage = match[6]
      ? this.normalizeDecimal({
          source: match[6],
          description: `approximate vote percentage in row ${rowNumber}`,
        })
      : ownershipPercentage;
    if (!match[6] && ownershipPercentage !== "100") {
      throw new FortnoxParseError(`Missing approximate vote percentage in row ${rowNumber}.`);
    }
    return overviewOwnerSchema.parse({
      name: this.requiredCapture({
        match,
        group: 1,
        description: "overview owner name",
      }),
      identifier: this.requiredCapture({
        match,
        group: 2,
        description: "overview owner identifier",
      }),
      count: this.parsePositiveInteger({
        source: this.requiredCapture({
          match,
          group: 3,
          description: "overview owner count",
        }),
        description: `overview owner count in row ${rowNumber}`,
      }),
      ownershipPercentage,
      votes: this.normalizeDecimal({
        source: this.requiredCapture({
          match,
          group: 5,
          description: "overview owner votes",
        }),
        description: `overview owner votes in row ${rowNumber}`,
      }),
      approximateVotePercentage,
    });
  }
}

export function parseFortnoxOwnerOverview(source: string): FortnoxOwnerOverview {
  return new OwnerOverviewParser(source).parse();
}
