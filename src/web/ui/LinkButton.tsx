import type { AnchorHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium no-underline " +
  "whitespace-nowrap transition-colors duration-100 select-none focus-visible:focus-ring";

const VARIANTS = {
  primary:
    "border-accent bg-accent text-ink-inverted hover:border-accent-hover hover:bg-accent-hover",
  secondary: "border-rule bg-surface text-ink shadow-raised hover:bg-surface-hover",
  ghost: "border-transparent bg-transparent text-ink hover:bg-surface-hover",
} as const;

const SIZES = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
} as const;

/**
 * A navigation target styled as a button. With React Router, pass the router's
 * `Link` through `render`-style composition at the call site:
 * `<LinkButton asChild>` is deliberately not supported — instead render
 * `<Link className={linkButtonClass(...)}>` for router links.
 */
export function LinkButton({
  variant = "secondary",
  size = "md",
  iconStart,
  iconEnd,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <a className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {iconStart}
      {children}
      {iconEnd}
    </a>
  );
}

/** Class names for a router `<Link>` that should look like a button. */
export function linkButtonClass(
  variant: keyof typeof VARIANTS = "secondary",
  size: keyof typeof SIZES = "md",
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}
