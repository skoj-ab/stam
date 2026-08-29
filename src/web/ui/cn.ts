import { type ClassNameValue, extendTailwindMerge } from "tailwind-merge";

/**
 * Stam's palette and radius scale are closed (see `styles/theme.css`), so
 * tailwind-merge is told about them. Without this it would not recognise
 * `bg-surface-sunken` as a background utility and a caller's `className`
 * override would silently lose to the component's own class.
 */
const COLORS = [
  "transparent",
  "current",
  "paper",
  "surface",
  "surface-sunken",
  "surface-hover",
  "surface-active",
  "ink",
  "ink-muted",
  "ink-subtle",
  "ink-inverted",
  "rule",
  "rule-strong",
  "rule-subtle",
  "accent",
  "accent-hover",
  "accent-active",
  "accent-ink",
  "accent-subtle",
  "accent-rule",
  "positive",
  "positive-ink",
  "positive-subtle",
  "positive-rule",
  "caution",
  "caution-ink",
  "caution-subtle",
  "caution-rule",
  "critical",
  "critical-ink",
  "critical-subtle",
  "critical-rule",
  "focus",
];

const twMerge = extendTailwindMerge({
  override: {
    theme: {
      color: COLORS,
      radius: ["none", "xs", "sm", "md", "lg", "full"],
      shadow: ["raised", "popover", "dialog"],
      font: ["sans", "serif", "mono"],
    },
    classGroups: {
      "font-size": [{ text: ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"] }],
    },
  },
});

/**
 * Joins class names and resolves Tailwind conflicts, last one winning.
 *
 * Always end a component's class list with the caller's `className` so
 * consumers can override: `cn(base, variants[variant], className)`.
 */
export function cn(...inputs: ClassNameValue[]): string {
  return twMerge(inputs);
}
