import { Combobox as Base } from "@base-ui-components/react/combobox";
import { cn } from "./cn";
import {
  CONTROL_BASE,
  CONTROL_SIZES,
  type ControlSize,
  POPUP_ITEM,
  POPUP_SURFACE,
} from "./controlStyles";
import { CheckIcon, ChevronUpDownIcon } from "./icons";

export type ComboboxOption<Value extends string> = {
  value: Value;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type ComboboxProps<Value extends string> = {
  options: readonly ComboboxOption<Value>[];
  value?: Value | null;
  defaultValue?: Value | null;
  onValueChange?: (value: Value | null) => void;
  placeholder?: string;
  /** Shown when the typed filter matches nothing. */
  emptyMessage?: string;
  name?: string;
  size?: ControlSize;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

/**
 * A filterable single-select. Use when the option list is long or open-ended —
 * choosing a shareholder, an existing share class, an event to reverse.
 */
export function Combobox<Value extends string>({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Sök…",
  emptyMessage = "Inga träffar",
  name,
  size = "md",
  disabled = false,
  required = false,
  className,
}: ComboboxProps<Value>) {
  const itemValues = options.map((option) => option.value);
  const findOption = (itemValue: Value) => options.find((option) => option.value === itemValue);

  return (
    <Base.Root<Value | null>
      items={itemValues}
      itemToStringLabel={(itemValue) =>
        itemValue === null ? "" : (findOption(itemValue)?.label ?? itemValue)
      }
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      disabled={disabled}
      required={required}
    >
      <div
        className={cn(
          CONTROL_BASE,
          CONTROL_SIZES[size],
          "gap-1 focus-within:focus-ring focus-within:border-accent",
          className,
        )}
      >
        <Base.Input
          placeholder={placeholder}
          className="w-full border-0 bg-transparent p-0 text-inherit outline-none"
        />
        <Base.Trigger
          className="shrink-0 rounded-xs text-ink-subtle hover:text-ink focus-visible:focus-ring"
          aria-label="Visa alternativ"
        >
          <Base.Icon>
            <ChevronUpDownIcon size={14} />
          </Base.Icon>
        </Base.Trigger>
      </div>
      <Base.Portal>
        <Base.Positioner sideOffset={4} className="z-50 outline-none">
          <Base.Popup className={cn(POPUP_SURFACE, "max-h-72 w-(--anchor-width) p-1")}>
            <Base.Empty className="px-2 py-3 text-center text-xs text-ink-subtle">
              {emptyMessage}
            </Base.Empty>
            <Base.List className="max-h-70 overflow-y-auto">
              {(itemValue: Value) => {
                const option = findOption(itemValue);
                if (!option) {
                  return null;
                }

                return (
                  <Base.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={cn(POPUP_ITEM, "justify-between gap-3 pr-1.5")}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate text-xs text-ink-subtle">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    <Base.ItemIndicator className="shrink-0 text-accent-ink">
                      <CheckIcon size={14} />
                    </Base.ItemIndicator>
                  </Base.Item>
                );
              }}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
