import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../ui/cn";
import { IconButton } from "../ui/IconButton";
import { MoonIcon, SunIcon } from "../ui/icons";
import { TooltipProvider } from "../ui/Popover";
import { useTheme, useThemeStorageSync } from "../ui/theme";

export type AppShellProps = {
  /** The company switcher and any global controls, next to the wordmark. */
  masthead?: ReactNode;
  /** The account menu, right-aligned. */
  account?: ReactNode;
  /** Primary navigation. Omit on the login and invitation routes. */
  nav?: ReactNode;
  children: ReactNode;
};

/**
 * The application frame: a thin masthead over the page, with navigation below
 * it and the content on paper. There is one shell — routes render inside it and
 * never draw their own chrome.
 */
export function AppShell({ masthead, account, nav, children }: AppShellProps) {
  useThemeStorageSync();
  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col bg-paper">
        <header className="sticky top-0 z-30 border-b border-rule bg-surface/95 backdrop-blur-sm">
          <div className="mx-auto flex h-12 w-full max-w-page items-center gap-3 px-4">
            <Link
              className="font-serif text-base font-semibold tracking-tight text-ink no-underline focus-visible:focus-ring"
              to="/companies"
            >
              Stam
            </Link>
            {masthead ? (
              <>
                <span className="h-4 border-l border-rule" aria-hidden="true" />
                {masthead}
              </>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              {account}
            </div>
          </div>
          {nav ? (
            <div className="mx-auto w-full max-w-page px-4">
              <nav aria-label="Huvudnavigering" className="flex gap-4">
                {nav}
              </nav>
            </div>
          ) : null}
        </header>
        <main className="mx-auto w-full max-w-page flex-1 px-4 py-6">{children}</main>
      </div>
    </TooltipProvider>
  );
}

export type NavLinkProps = {
  href: string;
  active?: boolean;
  children: ReactNode;
};

/**
 * One primary navigation target. With React Router, render its `Link` with
 * `navLinkClass(isActive)` instead of this element.
 */
export function NavLink({ href, active = false, children }: NavLinkProps) {
  return (
    <a href={href} aria-current={active ? "page" : undefined} className={navLinkClass(active)}>
      {children}
    </a>
  );
}

/** Class names for a router `<NavLink>`'s render prop. */
export function navLinkClass(active: boolean): string {
  return cn(
    "-mb-px border-b-2 px-0.5 pb-2 pt-1 text-sm font-medium no-underline transition-colors duration-100",
    "focus-visible:focus-ring",
    active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink",
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <IconButton
      label={resolved === "dark" ? "Byt till ljust utseende" : "Byt till mörkt utseende"}
      icon={resolved === "dark" ? <SunIcon /> : <MoonIcon />}
      size="sm"
      onClick={toggle}
    />
  );
}
