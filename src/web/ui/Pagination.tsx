import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

export type PaginationProps = {
  /** 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total rows across all pages, shown as context: "1–50 av 812". */
  totalCount?: number;
  pageSize?: number;
  className?: string;
};

/**
 * Page controls for a long register. Always show the row range — a user reading
 * a share register needs to know how much of it they are looking at.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  totalCount,
  pageSize,
  className,
}: PaginationProps) {
  const first = pageSize ? (page - 1) * pageSize + 1 : undefined;
  const last =
    pageSize && totalCount !== undefined ? Math.min(page * pageSize, totalCount) : undefined;

  return (
    <nav
      aria-label="Sidnavigering"
      className={cn("flex items-center justify-between gap-3 px-3 py-2", className)}
    >
      <p className="text-xs text-ink-muted tabular-nums">
        {first !== undefined && last !== undefined && totalCount !== undefined
          ? `${first}–${last} av ${totalCount}`
          : `Sida ${page} av ${pageCount}`}
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          label="Föregående sida"
          icon={<ChevronLeftIcon />}
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        <span className="px-2 text-xs text-ink-muted tabular-nums">
          {page} / {pageCount}
        </span>
        <IconButton
          label="Nästa sida"
          icon={<ChevronRightIcon />}
          size="sm"
          variant="secondary"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        />
      </div>
    </nav>
  );
}
