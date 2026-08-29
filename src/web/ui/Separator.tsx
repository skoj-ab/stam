import { cn } from "./cn";

export type SeparatorProps = {
  orientation?: "horizontal" | "vertical";
  /** `strong` closes a section or precedes a totals row. */
  weight?: "subtle" | "default" | "strong";
  className?: string;
};

const WEIGHTS = {
  subtle: "border-rule-subtle",
  default: "border-rule",
  strong: "border-rule-strong",
} as const;

/** A hairline. This system separates with rules, not shadows or whitespace. */
export function Separator({
  orientation = "horizontal",
  weight = "default",
  className,
}: SeparatorProps) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        "m-0",
        orientation === "horizontal"
          ? "w-full border-0 border-t"
          : "h-auto self-stretch border-0 border-l",
        WEIGHTS[weight],
        className,
      )}
    />
  );
}
