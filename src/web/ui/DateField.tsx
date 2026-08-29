import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from "./controlStyles";

export type DateFieldProps = Omit<ComponentPropsWithRef<"input">, "type" | "size"> & {
  size?: ControlSize;
};

/**
 * A calendar date. The native control is used deliberately: its value is
 * already the `YYYY-MM-DD` string the API expects, Swedish locale renders it in
 * that same order, and it costs no bundle weight or custom keyboard handling.
 *
 *   <Field label="Verkningsdag" description="Datum då överlåtelsen gäller.">
 *     <DateField name="effectiveDate" max={today} required />
 *   </Field>
 */
export function DateField({ size = "md", className, ...props }: DateFieldProps) {
  return (
    <input
      type="date"
      className={cn(
        CONTROL_BASE,
        CONTROL_SIZES[size],
        "tabular-nums",
        // The user agent's picker icon follows `color-scheme`, set in tokens.css.
        "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
        "[&::-webkit-calendar-picker-indicator]:opacity-60",
        "[&::-webkit-calendar-picker-indicator]:hover:opacity-100",
        className,
      )}
      {...props}
    />
  );
}
