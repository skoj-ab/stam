/**
 * Presentation-only formatting. These helpers decide how numbers and dates
 * *look*; they never decide what they mean. Domain rules live in
 * `src/domain`, and exact decimals stay strings all the way to the screen.
 */

const LOCALE = "sv-SE";

const INTEGER = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const PERCENTAGE = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  maximumFractionDigits: 2,
});

/**
 * Groups a share count with the Swedish thin-space separator: `10 000`.
 * Always pair with tabular figures — `Table.Cell numeric` does this for you.
 */
export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** Formats a fraction as a percentage with at most two decimal places. */
export function formatPercentage(value: number): string {
  return PERCENTAGE.format(value);
}

/**
 * Renders an exact decimal string (votes per share, subscription price) without
 * ever converting it to a JavaScript number.
 */
export function formatDecimal(value: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = INTEGER.format(BigInt(whole ?? "0"));
  return fraction ? `${grouped},${fraction}` : grouped;
}

/**
 * An inclusive share-number range as the register writes it: `1–6 000`.
 * The separator is an en dash, not a hyphen.
 */
export function formatShareRange(range: { from: number; to: number }): string {
  return range.from === range.to
    ? formatCount(range.from)
    : `${formatCount(range.from)}–${formatCount(range.to)}`;
}

/** A `YYYY-MM-DD` domain date, unchanged. ISO order is the Swedish order. */
export function formatDate(isoDate: string): string {
  return isoDate;
}

/** A UTC timestamp as local date and minute: `2026-08-28 14:05`. */
export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const parts = new Intl.DateTimeFormat(LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
