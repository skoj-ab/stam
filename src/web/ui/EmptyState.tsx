import type { ReactNode } from "react";
import { cn } from "./cn";
import { DocumentIcon } from "./icons";

export type EmptyStateProps = {
  /** What is missing, as a statement: "Inga händelser registrerade". */
  title: ReactNode;
  /** Why it is empty and what to do about it. One or two sentences. */
  description?: ReactNode;
  /** The action that resolves the emptiness, if there is one. */
  action?: ReactNode;
  icon?: ReactNode;
  /** `inline` sits inside a table or panel; `page` fills a route. */
  size?: "inline" | "page";
  className?: string;
};

/**
 * The state a register spends its first day in. Distinguish "nothing here yet"
 * from "nothing matched your filter" — the description must say which.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  size = "inline",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        size === "page" ? "px-6 py-20" : "px-4 py-10",
        className,
      )}
    >
      <span className="text-ink-subtle">{icon ?? <DocumentIcon size={24} />}</span>
      <p className="font-serif text-base font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-prose text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
