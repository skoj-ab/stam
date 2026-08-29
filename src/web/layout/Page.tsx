import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export type PageHeaderProps = {
  /** The record's name. One `h1` per route, and this is it. */
  title: ReactNode;
  /**
   * The line that qualifies the title — effective date, totals, source. A
   * register view without its cutoffs stated is ambiguous, so this is where
   * "Per 2026-08-28 · 10 000 aktier · 3 ägare" belongs.
   */
  meta?: ReactNode;
  /** Route-level actions. At most one `primary` button among them. */
  actions?: ReactNode;
  /** Breadcrumb or back link, rendered above the title. */
  above?: ReactNode;
  className?: string;
};

/** The heading block that opens every route. */
export function PageHeader({ title, meta, actions, above, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 pb-5", className)}>
      {above}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-serif text-2xl font-semibold text-ink">{title}</h1>
          {meta ? <p className="text-sm text-ink-muted tabular-nums">{meta}</p> : null}
        </div>
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="border-b border-rule-strong" />
    </header>
  );
}

export type PageSectionProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A titled band of a route. Sections stack with a consistent rhythm. */
export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: PageSectionProps) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 className="font-serif text-lg font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type PageBodyProps = {
  /**
   * `page` fills the shell width (register tables, event history).
   * `form` constrains to a single readable column (event registration).
   * `prose` constrains to running text (documentation, import reports).
   */
  width?: "page" | "form" | "prose";
  children: ReactNode;
  className?: string;
};

const WIDTHS = {
  page: "",
  form: "max-w-form",
  prose: "max-w-prose",
} as const;

/** The stacked content of a route, at the width the content deserves. */
export function PageBody({ width = "page", children, className }: PageBodyProps) {
  return <div className={cn("flex flex-col gap-6", WIDTHS[width], className)}>{children}</div>;
}
