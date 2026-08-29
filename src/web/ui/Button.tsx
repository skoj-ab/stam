import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /**
   * `primary` — the single affirmative action of a view or dialog.
   * `secondary` — the default for everything else; safe to repeat.
   * `ghost` — toolbar and table-row actions, where a border would add noise.
   * `danger` — irreversible register effects (cancellation, reversal).
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a spinner, disables the button and announces the busy state. */
  loading?: boolean;
  /** Icon rendered before the label. Use a 16px icon from `./icons`. */
  iconStart?: ReactNode;
  /** Icon rendered after the label, e.g. a chevron on a menu trigger. */
  iconEnd?: ReactNode;
  /** Stretches the button to its container, for stacked mobile actions. */
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium " +
  "whitespace-nowrap transition-colors duration-100 select-none " +
  "focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-ink-inverted hover:border-accent-hover hover:bg-accent-hover " +
    "active:border-accent-active active:bg-accent-active",
  secondary:
    "border-rule bg-surface text-ink shadow-raised hover:bg-surface-hover " +
    "active:bg-surface-active",
  ghost:
    "border-transparent bg-transparent text-ink hover:bg-surface-hover active:bg-surface-active",
  danger: "border-critical bg-critical text-ink-inverted hover:opacity-90 active:opacity-80",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
};

/**
 * The one button in the system. A link that looks like a button is still a
 * link — use `LinkButton` so keyboard and middle-click behaviour stay correct.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  iconStart,
  iconEnd,
  fullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : iconStart}
      {children}
      {iconEnd}
    </button>
  );
}
