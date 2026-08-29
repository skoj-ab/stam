import { Tabs as Base } from "@base-ui-components/react/tabs";
import type { ReactNode } from "react";
import { cn } from "./cn";

export type TabsProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
};

/**
 * Alternate views of the same record — "Aktuell aktiebok" / "Historik" /
 * "Händelser". Tabs must not change what the user is looking at, only how.
 * A different record is a different route.
 */
export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  return (
    <Base.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange as (value: unknown) => void}
      className={cn("flex flex-col", className)}
    >
      {children}
    </Base.Root>
  );
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Base.List className={cn("relative flex gap-4 border-b border-rule", className)}>
      {children}
      <Base.Indicator
        className={cn(
          "absolute bottom-0 left-0 h-0.5 bg-accent",
          "w-(--active-tab-width) translate-x-(--active-tab-left)",
          "transition-[translate,width] duration-150 ease-out",
        )}
      />
    </Base.List>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Base.Tab
      value={value}
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent px-0.5 pb-2 text-sm font-medium",
        "text-ink-muted transition-colors duration-100 hover:text-ink",
        "data-[selected]:text-ink",
        "focus-visible:focus-ring",
      )}
    >
      {children}
    </Base.Tab>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Base.Panel value={value} className="pt-4 outline-none focus-visible:focus-ring">
      {children}
    </Base.Panel>
  );
}
