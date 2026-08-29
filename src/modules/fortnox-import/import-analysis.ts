import {
  analysisSchema,
  type FortnoxCompany,
  type FortnoxDetailedPost,
  type FortnoxEvent,
  type FortnoxImportWarning,
  type FortnoxOwnerOverview,
  FortnoxParseError,
} from "./parser-model.ts";

type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>;
type DecimalComparison = Readonly<{ left: string; right: string }>;
type DecimalProductComparison = Readonly<{
  left: string;
  leftMultiplier: number;
  right: string;
  rightMultiplier: number;
}>;
type CompanySources = Readonly<{ detailed: FortnoxCompany; overview: FortnoxCompany }>;
type ImportSources = Readonly<{
  posts: readonly FortnoxDetailedPost[];
  overview: FortnoxOwnerOverview;
  events: readonly FortnoxEvent[];
}>;
type OwnerAggregate = Readonly<{ name: string; count: number; votes: string }>;
type ImportSummary = Readonly<{
  totalShares: number;
  totalVotes: string;
  owners: ReadonlyMap<string, OwnerAggregate>;
  warnings: FortnoxImportWarning[];
}>;
type PostValidation = Readonly<{
  post: FortnoxDetailedPost;
  referencePost: FortnoxDetailedPost;
  expectedFrom: number;
}>;
type OverviewOwner = FortnoxOwnerOverview["owners"][number];
type OverviewOwnerValidation = Readonly<{
  overviewOwner: OverviewOwner;
  aggregate: OwnerAggregate | undefined;
}>;

function exactDecimal({ source }: Readonly<{ source: string }>): ExactDecimal {
  const [integer = "0", fraction = ""] = source.split(".");
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function alignDecimals({
  left,
  right,
}: Readonly<{ left: ExactDecimal; right: ExactDecimal }>): readonly [bigint, bigint] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
  ];
}

function decimalEquals({ left, right }: DecimalComparison): boolean {
  const [leftAligned, rightAligned] = alignDecimals({
    left: exactDecimal({ source: left }),
    right: exactDecimal({ source: right }),
  });
  return leftAligned === rightAligned;
}

function decimalProductsEqual({
  left,
  leftMultiplier,
  right,
  rightMultiplier,
}: DecimalProductComparison): boolean {
  const [leftAligned, rightAligned] = alignDecimals({
    left: exactDecimal({ source: left }),
    right: exactDecimal({ source: right }),
  });
  return leftAligned * BigInt(leftMultiplier) === rightAligned * BigInt(rightMultiplier);
}

function addDecimal({ left, right }: DecimalComparison): string {
  const leftDecimal = exactDecimal({ source: left });
  const rightDecimal = exactDecimal({ source: right });
  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const [leftAligned, rightAligned] = alignDecimals({ left: leftDecimal, right: rightDecimal });
  const digits = (leftAligned + rightAligned).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const value = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function assertCompanyMatch({ detailed, overview }: CompanySources): void {
  if (companyIdentity(detailed) !== companyIdentity(overview)) {
    throw new FortnoxParseError(
      "The detailed register and owner overview identify different exports.",
    );
  }
}

function companyIdentity(company: FortnoxCompany): string {
  return JSON.stringify([company.legalName, company.organizationNumber, company.exportDate]);
}

class ImportAnalyzer {
  constructor(private readonly sources: ImportSources) {}

  analyze() {
    const shareClass = this.singleShareClass();
    const summary = this.summarizePosts();
    this.validateOverview(summary);
    this.collectEventWarnings(summary.warnings);

    return analysisSchema.parse({
      totalShares: summary.totalShares,
      totalVotes: summary.totalVotes,
      shareClass,
      checks: {
        rangeCounts: true,
        nonOverlappingRanges: true,
        contiguousRanges: true,
        votes: true,
        overviewTotals: true,
        overviewOwners: true,
        oneShareClass: true,
      },
      warnings: summary.warnings,
    });
  }

  private singleShareClass(): string {
    const sourceClasses = new Set(
      this.sources.posts.map((post) => this.detailedClassName({ source: post.shareClass })),
    );
    if (sourceClasses.size !== 1) {
      throw new FortnoxParseError("The register contains multiple share classes.");
    }
    const shareClass = sourceClasses.values().next().value;
    if (
      !shareClass ||
      shareClass !== this.overviewClassName({ source: this.sources.overview.shareClass })
    ) {
      throw new FortnoxParseError("The detailed register and overview share classes disagree.");
    }
    return shareClass;
  }

  private summarizePosts(): ImportSummary {
    const sortedPosts = [...this.sources.posts].sort(
      (left, right) => left.range.from - right.range.from,
    );
    const referencePost = sortedPosts[0];
    if (!referencePost) throw new FortnoxParseError("The detailed register has no posts.");

    let expectedFrom = 1;
    let totalShares = 0;
    let totalVotes = "0";
    const owners = new Map<string, OwnerAggregate>();
    const warnings: FortnoxImportWarning[] = [];
    for (const post of sortedPosts) {
      this.validatePost({ post, referencePost, expectedFrom });
      expectedFrom = post.range.to + 1;
      totalShares += post.count;
      totalVotes = addDecimal({ left: totalVotes, right: post.votes });
      this.aggregateOwner({ owners, post });
      this.collectHistoryWarnings({ warnings, post });
    }
    return { totalShares, totalVotes, owners, warnings };
  }

  private validatePost({ post, referencePost, expectedFrom }: PostValidation): void {
    this.assertRangeCount({ post });
    this.assertRangePosition({ post, expectedFrom });
    this.assertShareClassConsistency({ post, referencePost });
  }

  private assertRangeCount({ post }: Pick<PostValidation, "post">): void {
    const rangeCount = post.range.to - post.range.from + 1;
    if (post.range.to < post.range.from || rangeCount !== post.count) {
      throw new FortnoxParseError(
        `Post ${post.postNumber} range does not equal its reported count.`,
      );
    }
  }

  private assertRangePosition({
    post,
    expectedFrom,
  }: Pick<PostValidation, "post" | "expectedFrom">): void {
    if (post.range.from < expectedFrom) {
      throw new FortnoxParseError(`Post ${post.postNumber} overlaps a previous share range.`);
    }
    if (post.range.from > expectedFrom) {
      throw new FortnoxParseError(`There is a gap before post ${post.postNumber}.`);
    }
  }

  private assertShareClassConsistency({
    post,
    referencePost,
  }: Pick<PostValidation, "post" | "referencePost">): void {
    if (
      post.quotientValue !== referencePost.quotientValue ||
      !decimalProductsEqual({
        left: post.votes,
        leftMultiplier: referencePost.count,
        right: referencePost.votes,
        rightMultiplier: post.count,
      })
    ) {
      throw new FortnoxParseError(
        `Post ${post.postNumber} is inconsistent with its single share class.`,
      );
    }
  }

  private aggregateOwner({
    owners,
    post,
  }: Readonly<{ owners: Map<string, OwnerAggregate>; post: FortnoxDetailedPost }>): void {
    const aggregate = owners.get(post.owner.identifier);
    if (aggregate && aggregate.name !== post.owner.name) {
      throw new FortnoxParseError(`Owner ${post.owner.identifier} has inconsistent names.`);
    }
    owners.set(post.owner.identifier, {
      name: post.owner.name,
      count: (aggregate?.count ?? 0) + post.count,
      votes: addDecimal({ left: aggregate?.votes ?? "0", right: post.votes }),
    });
  }

  private collectHistoryWarnings({
    warnings,
    post,
  }: Readonly<{
    warnings: FortnoxImportWarning[];
    post: FortnoxDetailedPost;
  }>): void {
    for (const previousOwner of post.previousOwners) {
      if (previousOwner.enteredDate > post.enteredDate) {
        warnings.push({
          code: "SOURCE_HISTORY_ORDER",
          postNumber: post.postNumber,
          message: `Post ${post.postNumber} reports previous owner ${previousOwner.identifier} after the current owner entry; history must be reconstructed from source events.`,
        });
      }
    }
  }

  private validateOverview(summary: ImportSummary): void {
    const { overview } = this.sources;
    this.assertOverviewTotals({ summary, overview });
    if (summary.owners.size !== overview.owners.length) {
      throw new FortnoxParseError(
        "Detailed posts and the owner overview contain different owners.",
      );
    }

    const overviewIds = new Set<string>();
    for (const overviewOwner of overview.owners) {
      if (overviewIds.has(overviewOwner.identifier)) {
        throw new FortnoxParseError(`Duplicate overview owner ${overviewOwner.identifier}.`);
      }
      overviewIds.add(overviewOwner.identifier);
      this.assertOverviewOwnerMatches({
        overviewOwner,
        aggregate: summary.owners.get(overviewOwner.identifier),
      });
    }
  }

  private assertOverviewTotals({
    summary,
    overview,
  }: Readonly<{ summary: ImportSummary; overview: FortnoxOwnerOverview }>): void {
    if (
      summary.totalShares !== overview.totalCount ||
      !decimalEquals({ left: summary.totalVotes, right: overview.totalVotes })
    ) {
      throw new FortnoxParseError("Detailed post totals do not match the owner overview totals.");
    }
  }

  private assertOverviewOwnerMatches(validation: OverviewOwnerValidation): void {
    if (!this.overviewOwnerMatches(validation)) {
      throw new FortnoxParseError(
        `Overview owner ${validation.overviewOwner.identifier} does not match the detailed posts.`,
      );
    }
  }

  private overviewOwnerMatches({ overviewOwner, aggregate }: OverviewOwnerValidation): boolean {
    if (!aggregate) return false;
    return (
      this.normalizeOwnerName({ source: aggregate.name }) ===
        this.normalizeOwnerName({ source: overviewOwner.name }) &&
      aggregate.count === overviewOwner.count &&
      decimalEquals({ left: aggregate.votes, right: overviewOwner.votes })
    );
  }

  private collectEventWarnings(warnings: FortnoxImportWarning[]): void {
    const reconstructibleTypes = new Set(["Nyemission", "Transaktion", "Uppläggning"]);
    for (const event of this.sources.events) {
      if (!reconstructibleTypes.has(event.type)) {
        warnings.push({
          code: "UNSUPPORTED_EVENT_TYPE",
          sourceId: event.sourceId,
          message: `Fortnox event ${event.sourceId} (${event.type}) is retained as source history but is not safe to reconstruct automatically.`,
        });
      }
    }
  }

  private detailedClassName({ source }: Readonly<{ source: string }>): string {
    const match = source.match(/^(.+?)-?aktie$/i);
    return match?.[1]?.trim() || source;
  }

  private overviewClassName({ source }: Readonly<{ source: string }>): string {
    const match = source.match(/^(.+?)-?aktier$/i);
    return match?.[1]?.trim() || source;
  }

  private normalizeOwnerName({ source }: Readonly<{ source: string }>): string {
    return source.replace(/\s+/g, " ").trim();
  }
}

export function analyzeImport(sources: ImportSources) {
  return new ImportAnalyzer(sources).analyze();
}
