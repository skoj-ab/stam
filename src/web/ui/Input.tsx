import { Input as Base } from "@base-ui-components/react/input";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "./cn";
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from "./controlStyles";

export type InputProps = Omit<
  ComponentPropsWithRef<typeof Base>,
  "size" | "className" | "prefix"
> & {
  size?: ControlSize;
  className?: string;
  /** Static text or icon inside the leading edge, e.g. a search or unit glyph. */
  leading?: ReactNode;
  /** Static text or icon inside the trailing edge, e.g. "kr" or "st". */
  trailing?: ReactNode;
  /**
   * Right-aligns and locks tabular figures. Use for share counts, amounts and
   * anything a reader will compare down a column.
   */
  numeric?: boolean;
};

/**
 * A single-line text control. Always render it inside a `Field` — that is what
 * gives it a label, a description and an error message.
 */
export function Input({
  size = "md",
  leading,
  trailing,
  numeric = false,
  className,
  ...props
}: InputProps) {
  const control = (
    <Base
      inputMode={numeric ? "numeric" : props.inputMode}
      className={cn(
        leading || trailing ? "w-full border-0 bg-transparent p-0 outline-none" : CONTROL_BASE,
        leading || trailing ? "text-inherit" : CONTROL_SIZES[size],
        numeric && "text-right tabular-nums",
        !leading && !trailing && className,
      )}
      {...props}
    />
  );

  if (!leading && !trailing) {
    return control;
  }

  return (
    <div
      className={cn(
        CONTROL_BASE,
        CONTROL_SIZES[size],
        "gap-1.5 focus-within:focus-ring focus-within:border-accent",
        className,
      )}
    >
      {leading ? <span className="shrink-0 text-ink-subtle">{leading}</span> : null}
      {control}
      {trailing ? <span className="shrink-0 text-ink-subtle">{trailing}</span> : null}
    </div>
  );
}

export type TextareaProps = ComponentPropsWithRef<"textarea"> & {
  /** Visible rows before scrolling. Notes and explanations default to 3. */
  rows?: number;
};

/** Multi-line text, for import notes and correction explanations. */
export function Textarea({ rows = 3, className, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL_BASE, "min-h-16 resize-y px-2.5 py-1.5 text-sm", className)}
      {...props}
    />
  );
}
