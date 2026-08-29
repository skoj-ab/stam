import { Select as Base } from "@base-ui-components/react/select";
import { cn } from "./cn";
import {
  CONTROL_BASE,
  CONTROL_SIZES,
  type ControlSize,
  POPUP_ITEM,
  POPUP_SURFACE,
} from "./controlStyles";
import { CheckIcon, ChevronUpDownIcon } from "./icons";

export type SelectOption<Value extends string> = {
  value: Value;
  label: string;
  /** Secondary line, e.g. "1 röst per aktie" under a share class name. */
  description?: string;
  disabled?: boolean;
};

export type SelectProps<Value extends string> = {
  options: readonly SelectOption<Value>[];
  value?: Value | null;
  defaultValue?: Value | null;
  onValueChange?: (value: Value | null) => void;
  /** Shown when nothing is selected. Not an option — it cannot be chosen. */
  placeholder?: string;
  /** Submits with a surrounding `<form>`. */
  name?: string;
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

/**
 * A closed list of known options. Reach for `Combobox` instead when the list is
 * long enough that a user would rather type than scroll (shareholders).
 *
 *   <Field label="Aktieslag">
 *     <Select options={shareClasses} value={classId} onValueChange={setClassId} />
 *   </Field>
 */
export function Select<Value extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Välj…",
  name,
  size = "md",
  disabled = false,
  required = false,
  className,
}: SelectProps<Value>) {
  return (
    <Base.Root<Value>
      items={options as never}
      value={value as never}
      defaultValue={defaultValue as never}
      onValueChange={onValueChange as never}
      name={name}
      disabled={disabled}
      required={required}
    >
      <Base.Trigger
        className={cn(
          CONTROL_BASE,
          CONTROL_SIZES[size],
          "justify-between gap-2 text-left",
          className,
        )}
      >
        <Base.Value className="truncate">
          {(selectedValue: Value | null) =>
            options.find((option) => option.value === selectedValue)?.label ?? (
              <span className="text-ink-subtle">{placeholder}</span>
            )
          }
        </Base.Value>
        <Base.Icon className="shrink-0 text-ink-subtle">
          <ChevronUpDownIcon size={14} />
        </Base.Icon>
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-none">
          <Base.Popup className={cn(POPUP_SURFACE, "max-h-72 min-w-(--anchor-width) p-1")}>
            <Base.List className="max-h-70 overflow-y-auto">
              {options.map((option) => (
                <Base.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(POPUP_ITEM, "justify-between gap-3 pr-1.5")}
                >
                  <span className="flex min-w-0 flex-col">
                    <Base.ItemText className="truncate">{option.label}</Base.ItemText>
                    {option.description ? (
                      <span className="truncate text-xs text-ink-subtle">{option.description}</span>
                    ) : null}
                  </span>
                  <Base.ItemIndicator className="shrink-0 text-accent-ink">
                    <CheckIcon size={14} />
                  </Base.ItemIndicator>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
