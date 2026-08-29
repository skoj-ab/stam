import { Dialog as Base } from "@base-ui-components/react/dialog";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";

const BACKDROP =
  "fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px] " +
  "transition-opacity duration-150 " +
  "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

const POPUP =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] " +
  "-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-rule " +
  "bg-surface shadow-dialog transition-[opacity,transform] duration-150 " +
  "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 " +
  "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0";

const WIDTHS = {
  sm: "max-w-100",
  md: "max-w-140",
  lg: "max-w-200",
} as const;

export type DialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Rendered as the accessible name. Required — no anonymous dialogs. */
  title: ReactNode;
  /** One sentence saying what happens. Read out with the title. */
  description?: ReactNode;
  /** `sm` confirmations, `md` forms, `lg` review tables such as an import. */
  size?: keyof typeof WIDTHS;
  /** The action row. Put the primary action last. */
  footer?: ReactNode;
  children: ReactNode;
  /** Renders the trigger inside the dialog's context; optional if controlled. */
  trigger?: ReactNode;
  className?: string;
};

/**
 * A modal task. Use it for a short focused decision or a small form — a
 * register's long workflows belong on their own route, not in a dialog.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  footer,
  children,
  trigger,
  className,
}: DialogProps) {
  return (
    <Base.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Base.Trigger render={trigger as never} /> : null}
      <Base.Portal>
        <Base.Backdrop className={BACKDROP} />
        <Base.Popup className={cn(POPUP, WIDTHS[size], className)}>
          <div className="flex items-start gap-4 border-b border-rule px-5 py-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Base.Title className="font-serif text-lg font-semibold text-ink">{title}</Base.Title>
              {description ? (
                <Base.Description className="text-sm text-ink-muted">
                  {description}
                </Base.Description>
              ) : null}
            </div>
            <Base.Close
              render={<IconButton label="Stäng" icon={<CloseIcon />} className="-mr-1.5 ml-auto" />}
            />
          </div>
          {children ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          ) : null}
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-rule bg-surface-sunken px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** State the consequence plainly, including what cannot be undone. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for anything that changes the register irreversibly. */
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
};

/**
 * The confirmation step before an irreversible register effect. `confirmLabel`
 * must name the action ("Makulera aktier"), never "OK".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Avbryt",
  tone = "primary",
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
