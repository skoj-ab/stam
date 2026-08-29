/**
 * The shared shape of every text-entry control. Kept in one place so an input,
 * a select trigger, a combobox and a date field are visually identical.
 *
 * Feature code should not import this — use the components in this directory.
 */
export const CONTROL_BASE =
  "flex w-full items-center rounded-sm border border-rule bg-surface text-ink " +
  "transition-colors duration-100 " +
  "hover:border-rule-strong " +
  "focus-visible:focus-ring focus-visible:border-accent " +
  "data-[popup-open]:border-accent " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-subtle " +
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle " +
  "data-[invalid]:border-critical data-[invalid]:focus-visible:outline-critical " +
  "aria-invalid:border-critical";

export const CONTROL_SIZES = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-2.5 text-sm",
} as const;

export type ControlSize = keyof typeof CONTROL_SIZES;

/** Floating surfaces: menus, select popups, combobox lists, popovers. */
export const POPUP_SURFACE =
  "z-50 overflow-hidden rounded-md border border-rule bg-surface text-ink shadow-popover " +
  "origin-(--transform-origin) " +
  "data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.98] " +
  "data-[ending-style]:opacity-0 " +
  "transition-[opacity,transform] duration-100 ease-out";

/** A selectable row inside a floating surface. */
export const POPUP_ITEM =
  "flex cursor-default items-center gap-2 rounded-xs px-2 py-1.5 text-sm text-ink outline-none " +
  "select-none " +
  "data-[highlighted]:bg-surface-hover " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
