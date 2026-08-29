import { cn } from "./cn";

export type SpinnerProps = {
  size?: number;
  className?: string;
  /** Announced to assistive technology; omit inside an `aria-busy` control. */
  label?: string;
};

/** An indeterminate progress indicator. Prefer `Skeleton` for page loads. */
export function Spinner({ size = 16, className, label }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("animate-spin", className)}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path
        d="M14.25 8A6.25 6.25 0 008 1.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
