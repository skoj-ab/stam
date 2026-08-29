import { Menu as Base } from "@base-ui-components/react/menu";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { POPUP_ITEM, POPUP_SURFACE } from "./controlStyles";
import { CheckIcon } from "./icons";

export type MenuProps = {
  /** The control that opens the menu — usually a `Button` or `IconButton`. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

/**
 * A dropdown of actions. Actions only — a menu that sets a value is a `Select`,
 * and a menu of navigation targets is a list of links.
 *
 *   <Menu trigger={<Button iconEnd={<ChevronDownIcon />}>Åtgärder</Button>}>
 *     <MenuItem onClick={issue}>Nyemission…</MenuItem>
 *     <MenuSeparator />
 *     <MenuItem tone="danger" onClick={reverse}>Rätta händelse…</MenuItem>
 *   </Menu>
 */
export function Menu({ trigger, children, align = "end", side = "bottom", className }: MenuProps) {
  return (
    <Base.Root>
      <Base.Trigger render={trigger as never} />
      <Base.Portal>
        <Base.Positioner align={align} side={side} sideOffset={4} className="z-50 outline-none">
          <Base.Popup className={cn(POPUP_SURFACE, "min-w-44 p-1", className)}>
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export type MenuItemProps = {
  onClick?: () => void;
  disabled?: boolean;
  /** `danger` for destructive register effects. */
  tone?: "default" | "danger";
  iconStart?: ReactNode;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  hint?: ReactNode;
  children: ReactNode;
};

export function MenuItem({
  onClick,
  disabled = false,
  tone = "default",
  iconStart,
  hint,
  children,
}: MenuItemProps) {
  return (
    <Base.Item
      onClick={onClick}
      disabled={disabled}
      className={cn(
        POPUP_ITEM,
        tone === "danger" && "text-critical-ink data-[highlighted]:bg-critical-subtle",
      )}
    >
      {iconStart ? <span className="shrink-0 text-ink-subtle">{iconStart}</span> : null}
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-ink-subtle">{hint}</span> : null}
    </Base.Item>
  );
}

export function MenuSeparator() {
  return <Base.Separator className="my-1 border-t border-rule-subtle" />;
}

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Base.Group>
      <Base.GroupLabel className="px-2 py-1 text-2xs font-semibold text-ink-subtle uppercase">
        {label}
      </Base.GroupLabel>
      {children}
    </Base.Group>
  );
}

export type MenuCheckboxItemProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Keeps the menu open so several options can be toggled in one pass. */
  closeOnClick?: boolean;
  children: ReactNode;
};

/** A toggle inside a menu, for column visibility and saved view filters. */
export function MenuCheckboxItem({
  checked,
  onCheckedChange,
  closeOnClick = false,
  children,
}: MenuCheckboxItemProps) {
  return (
    <Base.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      closeOnClick={closeOnClick}
      className={POPUP_ITEM}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-accent-ink">
        <Base.CheckboxItemIndicator>
          <CheckIcon size={14} />
        </Base.CheckboxItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </Base.CheckboxItem>
  );
}
