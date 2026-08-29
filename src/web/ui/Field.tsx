import { Field as Base } from "@base-ui-components/react/field";
import { Fieldset as BaseFieldset } from "@base-ui-components/react/fieldset";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type FieldProps = {
  /** Visible label. Every control in this application has one. */
  label: ReactNode;
  /** Guidance shown under the label, before the user makes a mistake. */
  description?: ReactNode;
  /**
   * Server- or schema-derived message. Presence marks the field invalid, so
   * pass the API's Zod issue straight through.
   */
  error?: string;
  /** Marks the control required and shows the required marker. */
  required?: boolean;
  disabled?: boolean;
  /** The control: `Input`, `Textarea`, `Select`, `Combobox`, `DateField`, ... */
  children: ReactNode;
  className?: string;
};

/**
 * The label/description/error wrapper every form control belongs in.
 *
 * Association of label, description and error with the control is automatic —
 * do not add `htmlFor`, `id` or `aria-describedby` by hand.
 *
 *   <Field label="Antal aktier" description="Heltal, större än noll." error={issues.amount}>
 *     <Input name="amount" inputMode="numeric" />
 *   </Field>
 */
export function Field({
  label,
  description,
  error,
  required = false,
  disabled = false,
  children,
  className,
}: FieldProps) {
  return (
    <Base.Root
      disabled={disabled}
      invalid={Boolean(error)}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <Base.Label className="flex items-center gap-1 text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="text-critical-ink" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only">(obligatoriskt)</span> : null}
      </Base.Label>
      {description ? (
        <Base.Description className="text-xs text-ink-muted">{description}</Base.Description>
      ) : null}
      {children}
      {error ? (
        <Base.Error match={true} className="text-xs text-critical-ink">
          {error}
        </Base.Error>
      ) : null}
    </Base.Root>
  );
}

export type FieldsetProps = {
  /** The group's heading, rendered as a `<legend>`. */
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Groups related fields under a legend, e.g. a shareholder's address block. */
export function Fieldset({ legend, description, children, className }: FieldsetProps) {
  return (
    <BaseFieldset.Root className={cn("flex flex-col gap-3 border-0 p-0", className)}>
      <div className="flex flex-col gap-1">
        <BaseFieldset.Legend className="font-serif text-base font-semibold text-ink">
          {legend}
        </BaseFieldset.Legend>
        {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </BaseFieldset.Root>
  );
}

export type FormActionsProps = {
  /** `end` for dialogs and modal flows, `start` for full-page forms. */
  align?: "start" | "end";
  children: ReactNode;
  className?: string;
};

/** The action row that closes a form. Primary action last on `end`. */
export function FormActions({ align = "end", children, className }: FormActionsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-rule pt-4",
        align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      {children}
    </div>
  );
}
