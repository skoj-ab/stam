import { cn } from "./cn";

export type SkeletonProps = {
  /** Tailwind width utility, e.g. `w-32`. Vary widths across a list. */
  className?: string;
};

/** A loading placeholder shaped like the content that will replace it. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("block h-4 animate-pulse rounded-xs bg-surface-active", className)}
    />
  );
}

/** Placeholder rows matching the register table's rhythm. */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-label="Laddar" className="flex flex-col gap-px">
      {Array.from({ length: rows }, (_, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
        <div key={rowIndex} className="flex gap-3 border-b border-rule-subtle px-3 py-2.5">
          {Array.from({ length: columns }, (_, columnIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells have no identity
            <Skeleton key={columnIndex} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
