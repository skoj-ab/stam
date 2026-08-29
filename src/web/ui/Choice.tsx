import { Checkbox as BaseCheckbox } from "@base-ui-components/react/checkbox";
import { Field as BaseField } from "@base-ui-components/react/field";
import { Radio as BaseRadio } from "@base-ui-components/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { CheckIcon } from "./icons";

const BOX =
  "flex size-4 shrink-0 items-center justify-center rounded-xs border border-rule-strong " +
  "bg-surface transition-colors duration-100 " +
  "data-[checked]:border-accent data-[checked]:bg-accent data-[checked]:text-ink-inverted " +
  "data-[unchecked]:hover:border-ink-subtle " +
  "focus-visible:focus-ring " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

export type CheckboxProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** The clickable label. Omit only for a checkbox inside a table row header. */
  label?: ReactNode;
  description?: ReactNode;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** For a "select all" box whose rows are partially selected. */
  indeterminate?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** A single independent yes/no. Two or more related ones still use this. */
export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  label,
  description,
  name,
  value,
  disabled = false,
  indeterminate = false,
  className,
  "aria-label": ariaLabel,
}: CheckboxProps) {
  const control = (
    <BaseCheckbox.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      indeterminate={indeterminate}
      name={name}
      value={value}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      className={cn(BOX, !label && className)}
    >
      <BaseCheckbox.Indicator className="flex">
        {indeterminate ? <span className="h-px w-2 bg-current" /> : <CheckIcon size={12} />}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );

  if (!label) {
    return control;
  }

  // Base UI's checkbox renders a span with `role="checkbox"`, which a wrapping
  // <label> would not name. `Field.Label` wires `aria-labelledby` for us.
  return (
    <BaseField.Root disabled={disabled} className={cn("flex flex-col gap-0.5", className)}>
      <BaseField.Label className="flex cursor-pointer items-start gap-2">
        <span className="flex h-5 items-center">{control}</span>
        <span className="text-sm text-ink">{label}</span>
      </BaseField.Label>
      {description ? (
        <BaseField.Description className="pl-6 text-xs text-ink-muted">
          {description}
        </BaseField.Description>
      ) : null}
    </BaseField.Root>
  );
}

export type RadioOption<Value extends string> = {
  value: Value;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioGroupProps<Value extends string> = {
  options: readonly RadioOption<Value>[];
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  name?: string;
  disabled?: boolean;
  /** `horizontal` only for two or three short options. */
  orientation?: "vertical" | "horizontal";
  className?: string;
};

/**
 * One choice from a small, fully visible set — a transfer reason, an
 * individual/legal-entity shareholder kind. Longer sets belong in a `Select`.
 */
export function RadioGroup<Value extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled = false,
  orientation = "vertical",
  className,
}: RadioGroupProps<Value>) {
  return (
    <BaseRadioGroup
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange as (value: unknown) => void}
      name={name}
      disabled={disabled}
      className={cn(
        "flex gap-x-5 gap-y-2",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
    >
      {options.map((option) => (
        <BaseField.Root key={option.value} className="flex flex-col gap-0.5">
          <BaseField.Label className="flex cursor-pointer items-start gap-2">
            <span className="flex h-5 items-center">
              <BaseRadio.Root
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                  "border-rule-strong bg-surface transition-colors duration-100",
                  "data-[checked]:border-accent data-[checked]:bg-accent",
                  "data-[unchecked]:hover:border-ink-subtle",
                  "focus-visible:focus-ring",
                  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                )}
              >
                <BaseRadio.Indicator className="size-1.5 rounded-full bg-ink-inverted" />
              </BaseRadio.Root>
            </span>
            <span className="text-sm text-ink">{option.label}</span>
          </BaseField.Label>
          {option.description ? (
            <BaseField.Description className="pl-6 text-xs text-ink-muted">
              {option.description}
            </BaseField.Description>
          ) : null}
        </BaseField.Root>
      ))}
    </BaseRadioGroup>
  );
}

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  name?: string;
  className?: string;
  "aria-label"?: string;
};

/**
 * An immediate on/off toggle — a view setting such as "visa makulerade
 * aktier". For a value that is saved with a form, use `Checkbox`.
 */
export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  label,
  disabled = false,
  name,
  className,
  "aria-label": ariaLabel,
}: SwitchProps) {
  const control = (
    <BaseSwitch.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      name={name}
      aria-label={label ? undefined : ariaLabel}
      className={cn(
        "relative h-4.5 w-8 shrink-0 rounded-full border border-rule-strong bg-surface-sunken",
        "transition-colors duration-100 focus-visible:focus-ring",
        "data-[checked]:border-accent data-[checked]:bg-accent",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
      )}
    >
      <BaseSwitch.Thumb
        className={cn(
          "block size-3 translate-x-0.5 rounded-full bg-ink-subtle transition-transform duration-100",
          "data-[checked]:translate-x-4 data-[checked]:bg-ink-inverted",
        )}
      />
    </BaseSwitch.Root>
  );

  if (!label) {
    return <span className={className}>{control}</span>;
  }

  return (
    <BaseField.Root disabled={disabled} className={className}>
      <BaseField.Label className="flex cursor-pointer items-center gap-2">
        {control}
        <span className="text-sm text-ink">{label}</span>
      </BaseField.Label>
    </BaseField.Root>
  );
}
