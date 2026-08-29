import type { ReactNode } from "react";
import { cn } from "./cn";
import { CriticalIcon, InfoIcon, WarningIcon } from "./icons";

export type CalloutTone = "info" | "positive" | "caution" | "critical";

export type CalloutProps = {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
  /** Trailing actions, e.g. "Visa händelsen". Keep to one or two. */
  actions?: ReactNode;
  className?: string;
};

const TONES: Record<CalloutTone, { box: string; icon: string; node: ReactNode }> = {
  info: {
    box: "border-accent-rule bg-accent-subtle",
    icon: "text-accent-ink",
    node: <InfoIcon />,
  },
  positive: {
    box: "border-positive-rule bg-positive-subtle",
    icon: "text-positive-ink",
    node: <InfoIcon />,
  },
  caution: {
    box: "border-caution-rule bg-caution-subtle",
    icon: "text-caution-ink",
    node: <WarningIcon />,
  },
  critical: {
    box: "border-critical-rule bg-critical-subtle",
    icon: "text-critical-ink",
    node: <CriticalIcon />,
  },
};

/**
 * A message about the page or a form as a whole: an unsupported OCF import
 * object, a rejected backdated event, a successful append.
 *
 * A message about one field belongs in that `Field`'s `error` instead.
 * `critical` callouts use `role="alert"` so they interrupt appropriately.
 */
export function Callout({ tone = "info", title, children, actions, className }: CalloutProps) {
  const { box, icon, node } = TONES[tone];
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5", box, className)}
    >
      <span className={cn("mt-0.5 shrink-0", icon)}>{node}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="text-sm font-semibold text-ink">{title}</p> : null}
        <div className="text-sm text-ink-muted">{children}</div>
        {actions ? <div className="mt-1 flex gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
