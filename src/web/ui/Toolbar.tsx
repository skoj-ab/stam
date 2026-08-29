import type { ReactNode } from "react";
import { cn } from "./cn";
import { Input } from "./Input";
import { CloseIcon, SearchIcon } from "./icons";

export type ToolbarProps = {
  /** Filters and search, left-aligned. */
  children: ReactNode;
  /** Actions, pushed to the right: export, "Ny händelse", density toggle. */
  actions?: ReactNode;
  className?: string;
};

/**
 * The control strip above a table. It sits directly on the panel's top edge,
 * separated from the table body by the same hairline everything else uses.
 */
export function Toolbar({ children, actions, className }: ToolbarProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2", className)}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type SearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Say what is searched: "Sök aktieägare eller aktienummer". */
  placeholder: string;
  /** Accessible name when the placeholder is the only visible label. */
  label?: string;
  className?: string;
};

/** Free-text filtering. Debounce at the call site, not in this component. */
export function SearchField({
  value,
  onValueChange,
  placeholder,
  label,
  className,
}: SearchFieldProps) {
  return (
    <Input
      type="search"
      size="sm"
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      leading={<SearchIcon size={14} />}
      className={cn("w-56", className)}
    />
  );
}

export type FilterChipProps = {
  /** The dimension being filtered: "Aktieslag". */
  label: string;
  /** The active selection: "Serie A". Omit when the filter is off. */
  value?: string;
  /** Clears this one filter. Omit to render a non-removable chip. */
  onClear?: () => void;
  onClick?: () => void;
  className?: string;
};

/**
 * One applied filter, shown so the user always knows why a register snapshot
 * is not showing everything. Render every active filter — silent filtering of
 * a legal record is a defect, not a convenience.
 */
export function FilterChip({ label, value, onClear, onClick, className }: FilterChipProps) {
  const active = value !== undefined;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border text-xs",
        active ? "border-accent-rule bg-accent-subtle" : "border-rule bg-surface",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={cn(
          "flex h-6 items-center gap-1 rounded-sm px-2",
          onClick && "hover:bg-surface-hover",
          "focus-visible:focus-ring-inset disabled:cursor-default",
        )}
      >
        <span className="text-ink-subtle">{label}</span>
        {active ? <span className="font-medium text-ink">{value}</span> : null}
      </button>
      {onClear && active ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Ta bort filter: ${label}`}
          className={cn(
            "flex h-6 items-center rounded-r-sm border-l border-accent-rule px-1.5",
            "text-ink-subtle hover:bg-surface-hover hover:text-ink focus-visible:focus-ring-inset",
          )}
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
    </span>
  );
}

export type FilterBarProps = {
  children: ReactNode;
  /** Clears every filter at once. Show only while at least one is active. */
  onClearAll?: () => void;
  className?: string;
};

/** The row of applied `FilterChip`s, with a single escape hatch to reset. */
export function FilterBar({ children, onClearAll, className }: FilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {children}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-xs px-1.5 py-0.5 text-xs text-ink-muted underline underline-offset-2 hover:text-ink focus-visible:focus-ring"
        >
          Rensa alla
        </button>
      ) : null}
    </div>
  );
}
