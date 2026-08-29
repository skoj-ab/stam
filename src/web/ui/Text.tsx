import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type HeadingLevel = 1 | 2 | 3 | 4;

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  /** Document outline level. Drives the tag; use `size` to adjust appearance. */
  level?: HeadingLevel;
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
};

const HEADING_SIZES = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-2xl",
} as const;

const DEFAULT_HEADING_SIZE: Record<HeadingLevel, keyof typeof HEADING_SIZES> = {
  1: "xl",
  2: "lg",
  3: "md",
  4: "sm",
};

/** The serif voice of the register. Always sets a real `h1`–`h4` tag. */
export function Heading({ level = 2, size, className, children, ...props }: HeadingProps) {
  const Tag = `h${level}` as ElementType;
  const resolved = size ?? DEFAULT_HEADING_SIZE[level];
  return (
    <Tag className={cn("font-serif text-ink", HEADING_SIZES[resolved], className)} {...props}>
      {children}
    </Tag>
  );
}

export type TextProps = HTMLAttributes<HTMLElement> & {
  as?: "p" | "span" | "div" | "dd" | "dt" | "li";
  size?: "2xs" | "xs" | "sm" | "base";
  tone?: "default" | "muted" | "subtle" | "accent" | "positive" | "caution" | "critical";
  weight?: "normal" | "medium" | "semibold";
  /** Forces tabular figures on a non-table element such as a summary line. */
  numeric?: boolean;
  children: ReactNode;
};

const TONES = {
  default: "text-ink",
  muted: "text-ink-muted",
  subtle: "text-ink-subtle",
  accent: "text-accent-ink",
  positive: "text-positive-ink",
  caution: "text-caution-ink",
  critical: "text-critical-ink",
} as const;

const SIZES = {
  "2xs": "text-2xs",
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
} as const;

const WEIGHTS = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
} as const;

/** Body copy, labels and meta lines. Prose sits at `size="base"`. */
export function Text({
  as: Tag = "p",
  size = "base",
  tone = "default",
  weight = "normal",
  numeric = false,
  className,
  children,
  ...props
}: TextProps) {
  return (
    <Tag
      data-numeric={numeric || undefined}
      className={cn(SIZES[size], TONES[tone], WEIGHTS[weight], className)}
      {...props}
    >
      {children}
    </Tag>
  );
}

export type FieldLabelTextProps = HTMLAttributes<HTMLElement> & { children: ReactNode };

/**
 * The all-caps micro label used above table columns and in definition lists.
 * Do not hand-roll this treatment; it is the system's only use of letterspacing.
 */
export function MicroLabel({ className, children, ...props }: FieldLabelTextProps) {
  return (
    <span className={cn("text-2xs font-semibold text-ink-subtle uppercase", className)} {...props}>
      {children}
    </span>
  );
}
