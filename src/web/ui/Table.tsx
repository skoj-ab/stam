import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { createContext, use } from "react";
import { cn } from "./cn";

/*
 * The register table. Hairline rules, a sunken header, tabular figures and a
 * totals row — this is the component the application is really about.
 *
 *   <Table caption="Aktiebok per 2026-08-28">
 *     <TableHead>
 *       <TableRow>
 *         <TableHeaderCell>Aktienummer</TableHeaderCell>
 *         <TableHeaderCell numeric>Antal</TableHeaderCell>
 *       </TableRow>
 *     </TableHead>
 *     <TableBody>
 *       <TableRow>
 *         <TableCell mono>1–6 000</TableCell>
 *         <TableCell numeric>6 000</TableCell>
 *       </TableRow>
 *     </TableBody>
 *     <TableFoot>
 *       <TableRow>
 *         <TableCell>Summa</TableCell>
 *         <TableCell numeric>10 000</TableCell>
 *       </TableRow>
 *     </TableFoot>
 *   </Table>
 */

export type TableProps = HTMLAttributes<HTMLTableElement> & {
  /**
   * The table's accessible name. Always supply one — a register snapshot's
   * caption states its effective date, which is the whole point of the table.
   */
  caption?: ReactNode;
  /** Hides the caption visually while keeping it for assistive technology. */
  captionHidden?: boolean;
  /** `compact` for long registers; `default` for short summary tables. */
  density?: "default" | "compact";
  /** Disable when a surrounding composite panel already provides the border. */
  framed?: boolean;
  children: ReactNode;
};

type Density = "default" | "compact";

const DensityContext = createContext<Density>("default");

const CELL_PADDING: Record<Density, string> = {
  default: "px-3 py-2",
  compact: "px-2.5 py-1",
};

export function Table({
  caption,
  captionHidden = false,
  density = "default",
  framed = true,
  className,
  children,
  ...props
}: TableProps) {
  return (
    <DensityContext value={density}>
      <div className="w-full">
        {caption && !captionHidden ? (
          <div aria-hidden="true" className="mb-2 px-1 font-serif text-sm text-ink-subtle italic">
            {caption}
          </div>
        ) : null}
        <div
          className={cn(
            "w-full",
            framed && "overflow-hidden rounded-md border border-rule bg-surface",
          )}
        >
          <div className="w-full overflow-x-auto">
            <table
              data-density={density}
              className={cn("w-full min-w-max border-collapse text-sm", className)}
              {...props}
            >
              {caption ? <caption className="sr-only">{caption}</caption> : null}
              {children}
            </table>
          </div>
        </div>
      </div>
    </DensityContext>
  );
}

export function TableHead({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("bg-surface-sunken", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...props}>
      {children}
    </tbody>
  );
}

/** The totals section. Separated by a strong rule, as in a printed register. */
export function TableFoot({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot className={cn("border-t-2 border-rule-strong font-medium", className)} {...props}>
      {children}
    </tfoot>
  );
}

export type TableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  /** Marks the row as the current selection or the row a dialog acts on. */
  selected?: boolean;
  /** Adds hover feedback and a pointer. Pair with `onClick` and a real link. */
  interactive?: boolean;
};

export function TableRow({
  selected = false,
  interactive = false,
  className,
  children,
  ...props
}: TableRowProps) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-rule-subtle last:border-b-0",
        interactive && "cursor-pointer hover:bg-surface-hover",
        selected && "bg-accent-subtle",
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

export type TableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  /** Right-aligns the column. Use for every counted or measured column. */
  numeric?: boolean;
  /** Current sort direction, when the column is sortable. */
  sort?: "asc" | "desc" | "none";
};

export function TableHeaderCell({
  numeric = false,
  sort,
  className,
  children,
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope="col"
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      className={cn(
        "border-b border-rule text-2xs font-semibold text-ink-subtle uppercase",
        CELL_PADDING[use(DensityContext)],
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export type TableCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  /** Right-aligned tabular figures. Every count and amount uses this. */
  numeric?: boolean;
  /** Monospaced, for share-number ranges, event IDs and identifiers. */
  mono?: boolean;
  /** Secondary information: registration timestamps, source notes. */
  muted?: boolean;
  /** Renders a `<th scope="row">` — the row's identifying column. */
  header?: boolean;
};

export function TableCell({
  numeric = false,
  mono = false,
  muted = false,
  header = false,
  className,
  children,
  ...props
}: TableCellProps) {
  const Tag = header ? "th" : "td";
  return (
    <Tag
      scope={header ? "row" : undefined}
      className={cn(
        "align-top",
        CELL_PADDING[use(DensityContext)],
        header && "text-left font-medium",
        numeric && "text-right tabular-nums",
        mono && "font-mono text-xs tabular-nums",
        muted && "text-ink-muted",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
