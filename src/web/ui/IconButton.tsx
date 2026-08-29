import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required: an icon-only control has no visible name. */
  label: string;
  icon: ReactNode;
  variant?: "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  ref?: Ref<HTMLButtonElement>;
};

const VARIANTS = {
  secondary: "border-rule bg-surface text-ink shadow-raised hover:bg-surface-hover",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink",
  danger: "border-transparent bg-transparent text-critical-ink hover:bg-critical-subtle",
} as const;

const SIZES = {
  sm: "size-7",
  md: "size-8",
} as const;

/** A square control whose only content is an icon. `label` becomes its name. */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm border",
        "transition-colors duration-100 focus-visible:focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
