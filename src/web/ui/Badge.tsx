import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "positive" | "caution" | "critical";

export type BadgeProps = {
  /**
   * `positive` registered/active · `caution` draft/pending ·
   * `critical` reversed/cancelled · `accent` informational ·
   * `neutral` everything else.
   */
  tone?: BadgeTone;
  /** `solid` only where the badge must survive a dense colourful row. */
  variant?: "subtle" | "solid" | "outline";
  children: ReactNode;
  className?: string;
};

const SUBTLE: Record<BadgeTone, string> = {
  neutral: "border-rule bg-surface-sunken text-ink-muted",
  accent: "border-accent-rule bg-accent-subtle text-accent-ink",
  positive: "border-positive-rule bg-positive-subtle text-positive-ink",
  caution: "border-caution-rule bg-caution-subtle text-caution-ink",
  critical: "border-critical-rule bg-critical-subtle text-critical-ink",
};

const SOLID: Record<BadgeTone, string> = {
  neutral: "border-ink-muted bg-ink-muted text-ink-inverted",
  accent: "border-accent bg-accent text-ink-inverted",
  positive: "border-positive bg-positive text-ink-inverted",
  caution: "border-caution bg-caution text-ink-inverted",
  critical: "border-critical bg-critical text-ink-inverted",
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: "border-rule-strong bg-transparent text-ink-muted",
  accent: "border-accent-rule bg-transparent text-accent-ink",
  positive: "border-positive-rule bg-transparent text-positive-ink",
  caution: "border-caution-rule bg-transparent text-caution-ink",
  critical: "border-critical-rule bg-transparent text-critical-ink",
};

/**
 * A short status word attached to a record: an event type, a company's draft
 * state, a reversed entry. Never interactive — a clickable badge is a `Button`.
 */
export function Badge({ tone = "neutral", variant = "subtle", children, className }: BadgeProps) {
  const palette = variant === "solid" ? SOLID : variant === "outline" ? OUTLINE : SUBTLE;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5",
        "text-2xs font-semibold whitespace-nowrap uppercase",
        palette[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
