# Stam design system

This document is the reference for Stam's frontend. It records what the visual
language is, why it is that way, and what the rules are.

The living implementation is `src/web/routes/DesignSystemRoute.tsx`, served at
`http://localhost:5174/design` under `bun run dev`. When the document and the
code disagree, the code is correct and the document is a bug.

## Direction

A share register is a legal record. The interface reads like one.

- **Paper, not dashboard.** A warm off-white ground, near-black ink, and a
  single restrained ink-blue accent. No product-marketing colour.
- **Rules, not shadows.** Structure comes from hairlines. Elevation is reserved
  for content that genuinely floats over the page — menus, popovers, dialogs.
- **Serif headings, sans body.** Source Serif 4 gives headings the voice of a
  register; Inter carries dense UI and tabular figures.
- **Figures are tabular everywhere.** Share numbers, counts and dates are
  compared down columns, so they align by default rather than by opt-in.
- **Density is the default.** The base UI size is 14px because this application
  is long tables and long forms, not running prose.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Styling | Tailwind CSS v4, CSS-first config | Tokens live in CSS; the theme is closed so drift is a build error, not a review comment. |
| Interactive primitives | Base UI (`@base-ui-components/react`) | Focus management, keyboard handling and ARIA for select, combobox, menu, dialog, popover, tooltip, tabs and the choice controls. |
| Class merging | `tailwind-merge`, configured for our closed palette | A caller's `className` reliably wins over a component's own. |
| Fonts | `@fontsource-variable/*`, bundled | No CDN. A self-hosted container has no external requests to make. |
| Icons | Inline SVG in `ui/icons.tsx` | A fixed vocabulary of ~18 glyphs does not justify an icon dependency. |

Base UI is pinned at `1.0.0-rc.0`, which is the latest published release. It is
the one pre-stable dependency in the project; treat its upgrades as breaking
until it reaches 1.0.0.

## Contributor rules

These rules apply to every frontend change:

1. Import components from `src/web/ui/index.ts`, never from a component file or
   directly from `@base-ui-components/react`.
2. Use design tokens instead of literal colours or Tailwind's stock palette.
3. Do not use arbitrary Tailwind values outside `src/web/ui` and
   `src/web/layout`.
4. Use the wrapped form and table components instead of raw controls.
5. Do not use inline styles, except to assign a genuinely dynamic CSS custom
   property.

All user-facing copy is Swedish. Code, comments, and identifiers are English.
Comparable figures use tabular formatting, exact decimal values remain strings,
and share ranges render through `formatShareRange`. Historical views always
show their effective and knowledge cutoffs, and every applied filter remains
visible. Domain decisions belong in `src/domain` or `src/modules`, never in UI
components.

Add a component only when a pattern occurs in at least two real places and the
existing catalogue cannot express it. Export it from the UI barrel, demonstrate
all states on `/design`, and document it here.

## Tokens

All raw values live in `src/web/styles/tokens.css` and are mapped onto Tailwind
in `src/web/styles/theme.css`. Nothing else in the project may contain a colour
literal — `bun run lint` fails if it does.

### Colour

Utilities are named for the token: `bg-surface`, `text-ink-muted`,
`border-rule`.

| Group | Tokens | Use |
| --- | --- | --- |
| Ground | `paper` `surface` `surface-sunken` `surface-hover` `surface-active` | Page background; panels and popups; table headers and inset wells; row hover; pressed or selected. |
| Ink | `ink` `ink-muted` `ink-subtle` `ink-inverted` | Primary text; secondary text and descriptions; column labels, meta and placeholders; text on a solid fill. |
| Rules | `rule` `rule-strong` `rule-subtle` | The default hairline; totals rows and section closers; dividers inside a panel. |
| Accent | `accent` `accent-hover` `accent-active` `accent-ink` `accent-subtle` `accent-rule` | Primary actions and selection. `accent-ink` is the readable text weight; `accent` is the fill. |
| Status | `positive` `caution` `critical`, each with `-ink` `-subtle` `-rule` | Registered/active; draft, pending or backdated; reversed, cancelled or rejected. |
| Focus | `focus` | The single focus ring colour. |

The Tailwind stock palette is deleted (`--color-*: initial`). `bg-blue-500`,
`text-gray-700` and `bg-white` do not exist and produce no CSS; the linter
catches them because the failure is otherwise invisible.

### Themes

Three states, all handled by the tokens themselves:

- No `data-theme` attribute — `prefers-color-scheme` decides.
- `data-theme="light"` — pinned light.
- `data-theme="dark"` — pinned dark.

The choice is stored per browser under `stam.theme` and applied in `main.tsx`
before the first paint. Because every colour flows through a token that swaps
itself, component code contains no `dark:` variants at all. The variant exists
in `theme.css` for the rare exception, and responds to both the explicit choice
and the system preference.

### Typography

`--font-serif` Source Serif 4 · `--font-sans` Inter · `--font-mono` system
monospace. Tailwind's standard type scale is unchanged, with one addition:
`text-2xs` (11px, letterspaced, uppercase) for table column headers and the
micro labels in `DescriptionList`.

Base font size is 87.5% (14px). `slashed zero` is on and contextual alternates
are off, because a share number must be unambiguous.

### Radius, elevation, layout

Radii are small and crisp: `rounded-xs` 2px, `rounded-sm` 3px, `rounded-md` 4px,
`rounded-lg` 6px. Nothing in this application is pill-shaped.

Three shadows exist and each has one job: `shadow-raised` (a secondary button),
`shadow-popover` (menus, selects, popovers), `shadow-dialog` (modals).

Three content widths: `max-w-page` (84rem, the shell), `max-w-form` (34rem, a
single-column form), `max-w-prose` (68ch, running text).

Focus is one treatment, `focus-ring`, applied by every interactive component and
by `:focus-visible` in `base.css`. There is also `focus-ring-inset` for elements
flush against a container edge. Never remove a focus ring.

## Page structure

```text
AppShell                       masthead · company switcher · theme · account · nav
└── PageHeader                 h1 · meta line with cutoffs and totals · actions
└── PageBody   width=page|form|prose
    └── PageSection            h2 · description · section actions
        └── Panel              bordered block; flush when it holds a Table
            ├── Toolbar        search · FilterBar · table actions
            ├── Table          Head · Body · Foot(totals)
            └── Pagination     in the panel footer
```

`AppShell` is mounted once at the router level. Routes render inside it and
never draw their own chrome. Exactly one `PageHeader`, and therefore one `<h1>`,
per route.

## Component catalogue

Every component is exported from `src/web/ui/index.ts` and demonstrated on
`/design`. Props are documented at their definitions, in terms of the decision
they encode.

### Actions

| Component | Notes |
| --- | --- |
| `Button` | `primary` (one per view) · `secondary` (the default) · `ghost` (toolbars and rows) · `danger` (irreversible register effects). Sizes `sm`/`md`; `loading` handles the busy state. |
| `LinkButton`, `linkButtonClass` | A navigation target styled as a button. Use `linkButtonClass` on a router `Link`. |
| `IconButton` | Icon-only. `label` is required and becomes the accessible name. |
| `Menu`, `MenuItem`, `MenuSeparator`, `MenuGroup`, `MenuCheckboxItem` | Actions only. A menu that sets a value is a `Select`. |

### Forms

| Component | Notes |
| --- | --- |
| `Field` | The label/description/error wrapper. Association is automatic — never add `htmlFor` or `aria-describedby` by hand. Pass the API's Zod issue straight to `error`. |
| `Fieldset` | Groups related fields under a `<legend>`. |
| `FormActions` | The closing action row. Primary action last. |
| `Input`, `Textarea` | `numeric` right-aligns and locks tabular figures. `leading`/`trailing` hold static affixes such as `kr` or `st`. |
| `Select` | A closed list of known options. |
| `Combobox` | A filterable list, for shareholders and other long sets. |
| `Checkbox`, `RadioGroup`, `Switch` | `Checkbox` for a value saved with a form, `Switch` for a view setting that applies immediately. |
| `DateField` | The native date control. Its value is already the `YYYY-MM-DD` string the API expects, and Swedish locale renders it in that order. |

### Data

| Component | Notes |
| --- | --- |
| `Table` and parts | `caption` is required in spirit: a register snapshot's caption states its effective date and is shown above the framed table. Use `framed={false}` inside a composite `Panel`. `TableCell numeric` is for counts, `mono` for ranges and IDs, and `header` for the row's identifying column. `TableFoot` is separated by a strong rule, as in a printed register. |
| `Panel`, `DescriptionList` | A bordered block and the key/value facts inside it. Use panels for grouped content, not as an extra frame around a standalone table. |
| `Badge` | A status word. Never interactive. |
| `Toolbar`, `SearchField`, `FilterBar`, `FilterChip` | The control strip above a table. Render a chip for every active filter. |
| `Pagination` | Always shows the row range, not just the page number. |
| `Tabs` and parts | Alternate views of the same record. A different record is a different route. |
| `EmptyState` | Distinguish "nothing yet" from "nothing matched" in the description. |
| `Spinner`, `Skeleton`, `SkeletonRows` | `Skeleton` for page loads, `Spinner` for an action already under way. |

### Overlays and feedback

| Component | Notes |
| --- | --- |
| `Dialog` | A short focused decision or a small form. Long workflows get their own route. |
| `ConfirmDialog` | The step before an irreversible register effect. `confirmLabel` names the action ("Makulera 1 000 aktier"), never "OK". |
| `Popover` | Anchored non-modal content: a filter editor, a time-travel picker. |
| `Tooltip`, `TooltipProvider` | Short labels only. Never the sole location of information. |
| `Callout` | A message about a page or form. A message about one field goes in that `Field`'s `error`. `critical` uses `role="alert"`. |

### Utilities

`cn` (class merge), `formatCount`, `formatDecimal`, `formatShareRange`,
`formatDate`, `formatTimestamp`, `useTheme`, `setThemePreference`, and the icon
set from `ui/icons.tsx`.

Formatting is presentation only. `formatDecimal` takes an exact decimal string
and never converts it to a JavaScript number.

## Enforcement

`bun run lint` runs Biome and then `scripts/check-design-system.ts`. The script
checks what a formatter cannot:

| Rule | Catches |
| --- | --- |
| `no-literal-colour` | Hex, `rgb()`, `oklch()` outside `styles/tokens.css`. |
| `no-default-palette` | Tailwind stock palette classes, which now emit nothing at all. |
| `no-arbitrary-value` | `p-[13px]`-style one-offs outside `ui/` and `layout/`. |
| `no-raw-control` | `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>`, `<dialog>` outside `ui/`. |
| `no-direct-base-ui` | Base UI imported outside `ui/`. |
| `import-from-barrel` | Deep imports such as `../ui/Button`. |
| `no-inline-style` | `style={{ … }}`, unless it only sets a CSS custom property. |
| `no-css-import` | A stylesheet imported anywhere but `main.tsx`. |

Arbitrary values are permitted inside `src/web/ui` and `src/web/layout` because
that is where the system's own one-off geometry legitimately lives. Everywhere
else they are drift.

A line may opt out with a `design-system-ignore` comment. Each use should carry
a reason; if a rule blocks something legitimate more than once, extend the
design system instead.

## Accessibility commitments

- Every control has a visible label, or an explicit `label`/`aria-label`.
- Focus is never removed, and always the same ring.
- Base UI owns focus trapping, roving tabindex and ARIA for the composite
  widgets. Do not re-implement it and do not add a second headless library.
- Colour never carries meaning alone: status appears as a `Badge` with a word,
  not as a coloured dot.
- `prefers-reduced-motion` disables animation globally in `base.css`.
- Tables use real `<caption>`, `<th scope>` and `aria-sort`.

## Known limitations

- The frontend bundle is roughly 691 kB (214 kB gzipped), dominated by React
  Router and Base UI. Route-level code splitting is worth doing once there are
  real routes to split.
- Fontsource ships every unicode subset. The browser only downloads latin and
  latin-ext for Swedish text, but the extra `woff2` files do sit in the image.
- Base UI is at `1.0.0-rc.0`.
- There are no visual regression tests. `/design` is reviewed by eye.
