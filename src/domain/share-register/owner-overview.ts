import type { Holding, ShareClass, ShareRegisterSnapshot } from "./types.ts";

type DecimalParts = Readonly<{
  coefficient: bigint;
  scale: number;
}>;

export type OwnerOverviewRow = Readonly<{
  shareholderId: string;
  totalShares: number;
  ownershipPercentage: string;
  totalVotes: string;
  votingPercentage?: string;
}>;

export type OwnerOverview = Readonly<{
  owners: readonly OwnerOverviewRow[];
  totalShares: number;
  totalVotes: string;
}>;

function parseDecimal(value: string): DecimalParts {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid exact decimal: ${value}`);

  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  return Object.freeze({ coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length });
}

function formatDecimal(coefficient: bigint, scale: number): string {
  if (scale === 0) return coefficient.toString();

  const digits = coefficient.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function formatPercentage(part: bigint, total: bigint): string | undefined {
  if (total === 0n) return undefined;

  const hundredths = (part * 10_000n + total / 2n) / total;
  return formatDecimal(hundredths, 2);
}

function voteTotals(
  holdings: readonly Holding[],
  shareClasses: readonly Pick<ShareClass, "id" | "votesPerShare">[],
): Readonly<{ byShareholder: ReadonlyMap<string, bigint>; total: bigint; scale: number }> {
  const parsedClasses = shareClasses.map((shareClass) => ({
    id: shareClass.id,
    ...parseDecimal(shareClass.votesPerShare),
  }));
  const scale = parsedClasses.reduce(
    (maximum, shareClass) => Math.max(maximum, shareClass.scale),
    0,
  );
  const coefficients = new Map(
    parsedClasses.map((shareClass) => [
      shareClass.id,
      shareClass.coefficient * 10n ** BigInt(scale - shareClass.scale),
    ]),
  );
  const byShareholder = new Map<string, bigint>();
  let total = 0n;

  for (const holding of holdings) {
    const votesPerShare = coefficients.get(holding.shareClassId);
    if (votesPerShare === undefined) {
      throw new Error(`Missing share class ${holding.shareClassId} for voting-power calculation`);
    }
    const shareCount = BigInt(holding.range.to) - BigInt(holding.range.from) + 1n;
    const votes = shareCount * votesPerShare;
    byShareholder.set(
      holding.shareholderId,
      (byShareholder.get(holding.shareholderId) ?? 0n) + votes,
    );
    total += votes;
  }

  return Object.freeze({ byShareholder, total, scale });
}

export function createOwnerOverview({
  holdings,
  totalsByShareholder,
  shareClasses,
}: Pick<ShareRegisterSnapshot, "holdings" | "totalsByShareholder"> &
  Readonly<{ shareClasses: readonly Pick<ShareClass, "id" | "votesPerShare">[] }>): OwnerOverview {
  const totalShares = totalsByShareholder.reduce((sum, owner) => sum + owner.total, 0);
  const votes = voteTotals(holdings, shareClasses);
  const owners = totalsByShareholder.map(({ shareholderId, total }) => {
    const ownerVotes = votes.byShareholder.get(shareholderId) ?? 0n;
    const votingPercentage = formatPercentage(ownerVotes, votes.total);
    return Object.freeze({
      shareholderId,
      totalShares: total,
      ownershipPercentage: formatPercentage(BigInt(total), BigInt(totalShares)) ?? "0",
      totalVotes: formatDecimal(ownerVotes, votes.scale),
      ...(votingPercentage === undefined ? {} : { votingPercentage }),
    });
  });

  return Object.freeze({
    owners: Object.freeze(owners),
    totalShares,
    totalVotes: formatDecimal(votes.total, votes.scale),
  });
}
