import type { ReactNode } from "react";
import { cn } from "./cn";

export type PanelProps = {
  /** A heading for the block. Omit for an unlabelled container. */
  title?: ReactNode;
  /** One line of context under the title, e.g. the snapshot's cutoffs. */
  description?: ReactNode;
  /** Controls belonging to this block, right-aligned in the header. */
  actions?: ReactNode;
  /** Removes body padding — required when the body is a `Table` or `Toolbar`. */
  flush?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * A bordered block of related content — an event's detail or a form section.
 * Standalone tables draw their own frame; nesting panels is a sign the page
 * needs splitting, not another border.
 */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  footer,
  children,
  className,
}: PanelProps) {
  return (
    <section className={cn("overflow-hidden rounded-md border border-rule bg-surface", className)}>
      {title || actions ? (
        <header className="flex items-start gap-3 border-b border-rule px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <h2 className="font-serif text-base font-semibold text-ink">{title}</h2>
            ) : null}
            {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
          </div>
          {actions ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}
      <div className={flush ? undefined : "p-4"}>{children}</div>
      {footer ? (
        <footer className="border-t border-rule bg-surface-sunken px-4 py-2.5">{footer}</footer>
      ) : null}
    </section>
  );
}

export type DescriptionListProps = {
  items: ReadonlyArray<{ term: ReactNode; description: ReactNode }>;
  /** `stacked` for a narrow column, `inline` for a wide detail header. */
  layout?: "stacked" | "inline";
  className?: string;
};

/**
 * Key/value facts about one record: organisation number, registered office,
 * total shares, opening-state source. Renders a real `<dl>`.
 */
export function DescriptionList({ items, layout = "stacked", className }: DescriptionListProps) {
  return (
    <dl
      className={cn(
        layout === "stacked"
          ? "grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2"
          : "flex flex-wrap gap-x-8 gap-y-3",
        className,
      )}
    >
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: terms are positional, not keyed entities
        <div key={index} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-2xs font-semibold text-ink-subtle uppercase">{item.term}</dt>
          <dd className="text-sm text-ink tabular-nums">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
