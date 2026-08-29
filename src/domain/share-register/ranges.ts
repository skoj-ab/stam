import type { Holding, ShareRange } from "./types.ts";

export function normalizeRanges(ranges: readonly ShareRange[]): ShareRange[] {
  const sorted = ranges
    .map(({ from, to }) => ({ from, to }))
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized: ShareRange[] = [];

  for (const range of sorted) {
    const previous = normalized.at(-1);
    if (previous && range.from <= previous.to + 1) {
      normalized[normalized.length - 1] = {
        from: previous.from,
        to: Math.max(previous.to, range.to),
      };
    } else {
      normalized.push(range);
    }
  }

  return normalized;
}

export function rangesOverlap(left: ShareRange, right: ShareRange): boolean {
  return left.from <= right.to && right.from <= left.to;
}

export function intersectRanges(
  left: readonly ShareRange[],
  right: readonly ShareRange[],
): ShareRange[] {
  const intersections: ShareRange[] = [];
  for (const leftRange of normalizeRanges(left)) {
    for (const rightRange of normalizeRanges(right)) {
      const from = Math.max(leftRange.from, rightRange.from);
      const to = Math.min(leftRange.to, rightRange.to);
      if (from <= to) intersections.push({ from, to });
    }
  }
  return normalizeRanges(intersections);
}

export function subtractRanges(
  source: readonly ShareRange[],
  removed: readonly ShareRange[],
): ShareRange[] {
  let result = normalizeRanges(source);
  for (const removal of normalizeRanges(removed)) {
    const next: ShareRange[] = [];
    for (const range of result) {
      if (!rangesOverlap(range, removal)) {
        next.push(range);
        continue;
      }
      if (range.from < removal.from) next.push({ from: range.from, to: removal.from - 1 });
      if (range.to > removal.to) next.push({ from: removal.to + 1, to: range.to });
    }
    result = next;
  }
  return result;
}

export function rangesContain(
  available: readonly ShareRange[],
  requested: readonly ShareRange[],
): boolean {
  return subtractRanges(requested, available).length === 0;
}

export function rangesEqual(left: readonly ShareRange[], right: readonly ShareRange[]): boolean {
  const normalizedLeft = normalizeRanges(left);
  const normalizedRight = normalizeRanges(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every(
      (range, index) =>
        range.from === normalizedRight[index]?.from && range.to === normalizedRight[index]?.to,
    )
  );
}

export function countRanges(ranges: readonly ShareRange[]): number {
  return normalizeRanges(ranges).reduce((total, range) => total + range.to - range.from + 1, 0);
}

export function canonicalizeHoldings(holdings: readonly Holding[]): Holding[] {
  const sorted = holdings
    .map((holding) => ({ ...holding, range: { ...holding.range } }))
    .sort(
      (left, right) =>
        left.range.from - right.range.from ||
        left.range.to - right.range.to ||
        left.shareholderId.localeCompare(right.shareholderId) ||
        left.shareClassId.localeCompare(right.shareClassId),
    );
  const canonical: Holding[] = [];

  for (const holding of sorted) {
    const previous = canonical.at(-1);
    if (
      previous &&
      previous.shareholderId === holding.shareholderId &&
      previous.shareClassId === holding.shareClassId &&
      holding.range.from === previous.range.to + 1
    ) {
      canonical[canonical.length - 1] = {
        ...previous,
        range: { from: previous.range.from, to: holding.range.to },
      };
    } else {
      canonical.push(holding);
    }
  }

  return canonical;
}
