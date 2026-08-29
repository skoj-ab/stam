import { Popover as Base } from "@base-ui-components/react/popover";
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { POPUP_SURFACE } from "./controlStyles";

export type PopoverProps = {
  trigger: ReactNode;
  /** Optional heading; supply one whenever the panel holds more than a line. */
  title?: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
};

/**
 * Non-modal content anchored to a control: a filter editor, a snapshot
 * time-travel picker, an explanation of a projected range. Anything requiring
 * a decision before the user continues is a `Dialog` instead.
 */
export function Popover({
  trigger,
  title,
  children,
  align = "start",
  side = "bottom",
  className,
}: PopoverProps) {
  return (
    <Base.Root>
      <Base.Trigger render={trigger as never} />
      <Base.Portal>
        <Base.Positioner align={align} side={side} sideOffset={6} className="z-50 outline-none">
          <Base.Popup className={cn(POPUP_SURFACE, "w-72 p-3", className)}>
            {title ? (
              <Base.Title className="mb-2 font-serif text-sm font-semibold text-ink">
                {title}
              </Base.Title>
            ) : null}
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export type TooltipProps = {
  /** Short label only. A tooltip is never the only place information lives. */
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
};

/**
 * A hover/focus hint. Never put an action, a link or essential text in one —
 * touch users and screen readers may not reach it.
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children as never} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50 outline-none">
          <BaseTooltip.Popup
            className={cn(
              "z-50 rounded-sm bg-ink px-2 py-1 text-xs text-paper shadow-popover",
              "transition-opacity duration-100",
              "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/** Mount once near the app root so tooltips share one open/close delay. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={400} closeDelay={100}>
      {children}
    </BaseTooltip.Provider>
  );
}
