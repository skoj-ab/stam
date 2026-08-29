#!/usr/bin/env bun
/**
 * Design-system constraints, enforced as part of `bun run lint`.
 *
 * Biome checks how the code is written. This checks that the frontend stays
 * inside the design system: no literal colours, no ad-hoc spacing, no raw form
 * elements, no direct Base UI usage outside `src/web/ui`.
 *
 * Each rule exists because it is a drift path that review reliably misses. If a
 * rule blocks something legitimate, change the design system — add the token,
 * add the component — rather than adding an exception here.
 */

import { Glob } from "bun";

type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
  source: string;
};

const WEB_ROOT = "src/web";

/** The design system's own implementation; the rules that apply differ here. */
const SYSTEM_PATHS = [`${WEB_ROOT}/ui/`, `${WEB_ROOT}/layout/`];

/** The one file allowed to hold raw colour values. */
const TOKENS_FILE = `${WEB_ROOT}/styles/tokens.css`;

/** The one file allowed to import a stylesheet. */
const STYLES_ENTRY = `${WEB_ROOT}/styles/index.css`;

function isSystemFile(file: string): boolean {
  return SYSTEM_PATHS.some((path) => file.startsWith(path));
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\s*\(/;
const ARBITRARY_UTILITY = /(?:^|[\s"'`])(?:[a-z]+:)*-?[a-z][a-z0-9-]*-\[[^\]]+\]/;
const CLASS_ATTRIBUTE = /class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

/**
 * Tailwind's stock palette is dropped in `theme.css`, so these utilities emit
 * nothing at all. Without this rule the mistake is invisible: the class is
 * written, the build succeeds, and the element is simply unstyled.
 */
const REMOVED_PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|divide|decoration|caret|placeholder|from|via|to|shadow)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\b(?:bg|text|border|fill|stroke|divide|placeholder)-(?:white|black)\b/;
const RAW_ELEMENT = /<(button|input|select|textarea|table|dialog)[\s>]/;
const INLINE_STYLE = /style=\{\{/;
const DEEP_UI_IMPORT = /from\s+["'][^"']*\/ui\/[A-Z][A-Za-z]*["']/;
const BASE_UI_IMPORT = /from\s+["']@base-ui-components\//;
const CSS_IMPORT = /import\s+["'][^"']+\.css["']/;

function checkTsx(file: string, source: string, violations: Violation[]): void {
  const lines = source.split("\n");
  const system = isSystemFile(file);

  for (const [index, line] of lines.entries()) {
    const at = index + 1;
    const record = (rule: string, message: string) => {
      violations.push({ file, line: at, rule, message, source: line.trim() });
    };

    if (line.includes("design-system-ignore")) {
      continue;
    }

    if (COLOR_LITERAL.test(line)) {
      record(
        "no-literal-colour",
        `Literal colour. Add a token to ${TOKENS_FILE} and use its utility (bg-surface, text-ink-muted, …).`,
      );
    }

    if (BASE_UI_IMPORT.test(line) && !file.startsWith(`${WEB_ROOT}/ui/`)) {
      record(
        "no-direct-base-ui",
        "Base UI is wrapped by src/web/ui. Import the Stam component, or add a wrapper there.",
      );
    }

    if (CSS_IMPORT.test(line) && !file.endsWith("main.tsx")) {
      record("no-css-import", `Stylesheets are imported once, by main.tsx from ${STYLES_ENTRY}.`);
    }

    if (INLINE_STYLE.test(line) && !line.includes('"--') && !line.includes("'--")) {
      record(
        "no-inline-style",
        "Inline styles bypass the token system. Use utilities, or a CSS custom property if the value is dynamic.",
      );
    }

    if (!system) {
      if (DEEP_UI_IMPORT.test(line)) {
        record(
          "import-from-barrel",
          'Import from the barrel: `from "../ui"`, not from a component file.',
        );
      }

      const rawElement = RAW_ELEMENT.exec(line);
      if (rawElement) {
        record(
          "no-raw-control",
          `<${rawElement[1]}> is provided by the design system. Use the component from src/web/ui.`,
        );
      }
    }

    for (const match of line.matchAll(CLASS_ATTRIBUTE)) {
      const classes = match[1] ?? match[2] ?? match[3] ?? "";

      if (REMOVED_PALETTE.test(classes)) {
        record(
          "no-default-palette",
          "Tailwind's stock palette is removed; this class produces no styles. Use a Stam colour token.",
        );
      }

      if (!system && ARBITRARY_UTILITY.test(` ${classes}`)) {
        record(
          "no-arbitrary-value",
          "Arbitrary Tailwind value. Use a scale step, or extend the theme in src/web/styles/theme.css.",
        );
      }
    }
  }
}

function checkCss(file: string, source: string, violations: Violation[]): void {
  if (file === TOKENS_FILE) {
    return;
  }
  for (const [index, line] of source.split("\n").entries()) {
    if (line.includes("design-system-ignore")) {
      continue;
    }
    if (COLOR_LITERAL.test(line)) {
      violations.push({
        file,
        line: index + 1,
        rule: "no-literal-colour",
        message: `Raw colour values belong in ${TOKENS_FILE}.`,
        source: line.trim(),
      });
    }
  }
}

async function main(): Promise<void> {
  const violations: Violation[] = [];

  for await (const relative of new Glob("**/*.{ts,tsx,css}").scan({ cwd: WEB_ROOT })) {
    const file = `${WEB_ROOT}/${relative}`;
    const source = await Bun.file(file).text();
    if (file.endsWith(".css")) {
      checkCss(file, source, violations);
    } else {
      checkTsx(file, source, violations);
    }
  }

  if (violations.length === 0) {
    console.log("design system: ok");
    return;
  }

  console.error(`design system: ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.rule}`);
    console.error(`    ${violation.message}`);
    console.error(`    | ${violation.source}\n`);
  }
  console.error("See docs/design-system.md and src/web/CLAUDE.md.");
  console.error("A line may opt out with a `design-system-ignore` comment and a reason.");
  process.exit(1);
}

await main();
