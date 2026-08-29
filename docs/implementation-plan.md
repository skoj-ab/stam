# Stam implementation plan

## Status

This document records the initial architecture and implementation plan for Stam,
a small, self-hosted share-register application for Swedish private limited
companies.

The plan deliberately keeps the product narrower than a general cap-table or
corporate-governance system. It prioritizes deterministic historical records,
auditability, and simple self-hosting.

Milestones 1 through 4 are complete. The foundation, domain engine, persistence,
authentication, core HTTP API, self-hosting model, core Swedish application
workflows, OCF interoperability, and operational tooling are implemented. The
frontend design framework is documented in `docs/design-system.md`, with
implementation rules in `src/web/CLAUDE.md`.

## Product boundaries

Stam will support:

- Multiple companies in one installation.
- Multiple locally authenticated users.
- Access to every company for every authenticated user.
- An immutable history of ownership changes.
- Current and historical share-register snapshots.
- Individually numbered shares represented as contiguous ranges.
- Multiple share classes without preferred-share economics.
- Local deployment as one application container with SQLite on a persistent
  volume.
- A supported-profile Open Cap Table Format (OCF) v1.2.0 import and export boundary.

Stam will not have company memberships, tenants, organizations, permission
matrices, or per-company roles in v1. Authentication answers who the user is;
an authenticated session grants access to all application companies.

The initial ownership event scope is limited to:

- Verified opening-state import.
- New share issuance.
- Share transfer.
- Share cancellation or redemption where shares cease to exist.
- Shareholder details change.
- Explicit correction through a compensating reversal.

Unsupported actions, including conversions, warrants, convertibles, mergers,
demergers, and automated transfer-restriction processing, must be reported
explicitly rather than approximated. Share splits and complete renumbering are
supported as structural, non-reversible events.

## Architecture

Stam will be a modular monolith:

```text
React SPA
   |
Hono HTTP server
   |
Application services
   |
Domain event and projection engine
   |
Drizzle ORM
   |
SQLite /data/stam.sqlite
```

Proposed source layout:

```text
src/
  domain/
    share-register/
  modules/
    auth/
    companies/
    shareholders/
    share-classes/
    share-events/
    projections/
    share-register/
    audit/
    ocf/
  db/
  server/
  web/
```

The range and projection engine must not depend on HTTP, React, Better Auth,
Drizzle, or SQLite. HTTP handlers should authenticate and validate requests,
then delegate to application services. React components must not contain share
ownership rules.

## Technology choices

| Concern | Choice |
| --- | --- |
| Runtime | Bun, pinned to an exact tested release |
| HTTP server | Hono |
| Frontend | React, Vite, React Router data mode |
| Database | SQLite through `bun:sqlite` |
| Typed SQL and migrations | Drizzle ORM and Drizzle Kit |
| Input and event validation | Zod |
| Authentication | Better Auth with passkey and admin plugins |
| Tests | Bun test, with `fast-check` for selected range properties |
| Formatting and linting | Biome |
| Deployment | Multi-stage Docker image, one process, one replica |

Drizzle is preferred over Kysely for this implementation because it officially
supports `bun:sqlite` and the Better Auth adapter. Kysely's standard SQLite
dialect expects `better-sqlite3`, which would add a native dependency or require
a community Bun dialect.

Hono and a Vite-built SPA keep the runtime explicit and small. The application
does not need SSR, SEO, or a second production server framework.

## Domain model

### Company

A company is an issuer and an aggregate boundary for its shareholders, share
classes, and event sequence. Company registration identifiers should be stored
in a generic country/scheme/value structure, with Swedish validation isolated
in a jurisdiction-specific module.

Companies may be prepared in a draft state before an opening state is accepted.
An active company has exactly one opening-state event.

### Shareholder

A shareholder belongs to one company and is either an individual or a legal
entity. Deliberately duplicating the same real-world holder between issuers is
simpler than introducing a cross-company party registry in v1.

```ts
type Shareholder = {
  id: string;
  companyId: string;
  kind: "INDIVIDUAL" | "LEGAL_ENTITY";
  identifierCountryCode: "SE";
  identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
  identifierValue: string;
  initialDetails: ShareholderDetails;
  effectiveFrom: string;
};

type ShareholderDetails = {
  legalName: string;
  emailAddress?: string;
  phoneNumber?: string;
  address: {
    lines: string[];
    postalCode: string;
    locality: string;
    countryCode: string;
  };
};
```

The normalized identifier is immutable and unique within a company, while the
same real-world holder remains a separate record in every company. Initial
details are immutable. Later details are full snapshots carried by
`SHAREHOLDER_DETAILS_CHANGED` events so that historical register snapshots do
not accidentally show a shareholder's current address or name.

The exact statutory Swedish fields will be validated before the final register
renderer is implemented. Jurisdiction-specific requirements must remain
isolated rather than spread through the ownership engine.

### Share class

```ts
type ShareClass = {
  id: string;
  companyId: string;
  name: string;
  votesPerShare: string;
};
```

`votesPerShare` is an exact decimal string, not a JavaScript floating-point
number. Share-class conversion and advanced preferred economics are outside
v1.

### Share range

```ts
type ShareRange = {
  from: number;
  to: number;
};
```

Both endpoints are inclusive positive safe integers. Share numbers are unique
across a company, not only within a class. Input range collections are sorted
and normalized before validation.

The projection engine splits ranges when only part of a holding changes owner:

```text
Before:
#1-1000 Henrik

Transfer:
#201-300 Henrik -> Ludde

After:
#1-200 Henrik
#201-300 Ludde
#301-1000 Henrik
```

Adjacent projected ranges with the same owner and class may be coalesced.
Immutable event payloads are never rewritten or coalesced.

## Event model

Every event has common immutable metadata:

```ts
type EventMetadata = {
  id: string;
  companyId: string;
  sequence: number;
  schemaVersion: number;
  effectiveDate: string; // YYYY-MM-DD
  registeredAt: string;  // UTC timestamp
  registeredBy: string;  // Better Auth user ID
};
```

The sequence is allocated transactionally per company. Events are replayed in
`effectiveDate`, then `sequence`, order. A newly registered backdated event is
accepted only if replaying the complete later timeline remains valid.

### OpeningStateImported

`OPENING_STATE_IMPORTED` establishes a verified opening state without claiming
that Stam knows the earlier transaction history. Its payload contains holdings
grouped by shareholder and class, the source type, and a mandatory import note.

### SharesIssued

`SHARES_ISSUED` contains one shareholder, one share class, one or more ranges,
and optional subscription-price metadata. A legal issue involving several
recipients can append a correlated event batch while keeping each event simple.

### SharesTransferred

`SHARES_TRANSFERRED` contains the transferor, transferee, class, ranges, and one
of these reasons:

```text
SALE
GIFT
INHERITANCE
DIVISION_OF_PROPERTY
OTHER
```

### SharesCancelled

`SHARES_CANCELLED` contains the current owner, class, ranges, and a reason such
as `REDEMPTION`, `CANCELLATION`, or `OTHER`. It records the register effect and
does not attempt to model the complete surrounding corporate-law process.

### ShareholderDetailsChanged

`SHAREHOLDER_DETAILS_CHANGED` contains complete before and after detail
snapshots. The application service derives and validates the before value so a
client cannot forge it.

### EventReversed

`EVENT_REVERSED` references one existing event and requires an explanation. It
applies the inverse effect on the correction's effective date. The target event
remains in history and is never edited.

A reversal may target an uncorrected opening state, issue, transfer,
cancellation, or shareholder-details change. Reversing another reversal is not
supported initially. If a corrected issue requires replacement data, the
reversal and replacement event can be appended atomically.

Ordinary cancellations retire share numbers. Reversing an erroneous issuance
may release only those exact numbers for a replacement in the same correction
operation.

## Historical snapshots

Snapshots support effective time and registration time:

```ts
createSnapshot({
  effectiveOn: "2024-06-20",
  knownAt: "2026-08-28T12:00:00Z",
});
```

`effectiveOn` answers what ownership was effective on a given date. `knownAt`
defaults to now and makes it possible to reproduce what the application knew
before a later event or correction was registered.

A `ShareRegisterSnapshot` will contain:

- Company identity.
- Effective and registration-time cutoffs.
- Share classes and totals.
- Historical shareholder details.
- Holdings sorted by share number.
- Applied event sequence information.
- Generation timestamp.

The snapshot is the input boundary for HTML/PDF rendering, OCF export, and
future formats.

## Invariants

The domain and application layers enforce these rules independently of the UI:

- Range endpoints are positive safe integers and `from <= to`.
- Ranges in one command do not overlap.
- Every active share number has exactly one owner and one class.
- Every referenced shareholder and class belongs to the event's company.
- An opening state can be registered only once.
- Transfers require every selected share to exist and belong to the stated
  transferor at that effective point.
- Transfers cannot mix share classes.
- Issuances cannot overlap active or retired numbers, except for the narrow
  correction replacement case.
- Cancellations require active ownership by the stated shareholder.
- Cancelled shares cannot subsequently be transferred.
- A backdated event must leave the complete subsequent stream valid.
- A correction may target only an existing, not-yet-corrected domain event.
- A reversal must be executable against the projected state at its effective
  position.
- Historical projection is deterministic for the same stream and cutoffs.
- Unsupported or ambiguous import data is never silently discarded.

## Persistence and transactions

Initial application tables:

```text
companies
shareholders
current_shareholder_details
share_classes
share_events
current_share_ranges
invitations
```

Better Auth adds its local user, account, session, verification, and passkey
tables to the same database.

`share_events` is append-only. SQLite triggers will reject updates and deletes.
`current_share_ranges` and `current_shareholder_details` are disposable,
rebuildable projections rather than sources of truth.

Appending an event or event batch uses one write transaction:

```text
BEGIN IMMEDIATE
  load the immutable company event stream
  add candidate events in memory
  replay and validate the complete stream
  insert immutable event rows
  replace the materialized current projection
COMMIT
```

Any validation or projection failure rolls the whole operation back.
`BEGIN IMMEDIATE` serializes the expected small number of writers and avoids a
validate-then-append race.

SQLite connections will use:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

Operational conventions:

- The database defaults to `/data/stam.sqlite`.
- Production supports one application replica.
- `/data` must be a durable local Docker volume, not a network filesystem.
- Committed migrations run before the HTTP listener starts.
- Shutdown stops accepting requests, checkpoints WAL, and closes SQLite.
- Backups use SQLite's online backup facility rather than copying a live file.
- Backup and restore documentation includes restoration verification.

The default deployment remains one application service:

```bash
docker run \
  -v ./data:/data \
  -e AUTH_SECRET=... \
  -e PUBLIC_ORIGIN=https://stam.example.se \
  ghcr.io/skoj-ab/stam
```

## Authentication and authorization

Public sign-up is disabled. Better Auth stores users, passkeys, and sessions in
SQLite.

The selected onboarding flow is:

1. Bootstrap the first administrator locally.
2. Let an administrator create an expiring, single-use invitation URL.
3. Store only a hash of the invitation token.
4. Bind the invitation to the intended email address.
5. Let the invitee enroll a passkey and receive a local session.
6. Allow an administrator to issue a recovery or passkey re-enrollment link.

SMTP is not required; invitation URLs can be shared out of band. Email/password
is retained only where useful for initial bootstrap or explicit recovery.

Better Auth's global administrator role protects invitation and user-management
operations only. It does not grant additional company access. All authenticated
users can access all companies, and there will be no company-membership table.
User-owned API keys authenticate the same application API with the owning user's
current global role and all-company access. Keys do not introduce scopes,
service accounts, organizations, or a second authorization model. Better Auth
account and credential-management endpoints remain session-cookie-only.

Passkeys require HTTPS outside localhost. Production configuration therefore
needs stable `PUBLIC_ORIGIN` and `WEBAUTHN_RP_ID` values. TLS termination may be
provided by the host's existing reverse proxy and does not require another
service in Stam's default Compose file.

## OCF interoperability

Research was performed against the Open Cap Table Coalition's stable OCF
v1.2.0 release. The repository's current main branch identifies itself as an
unreleased `1.2.1-alpha+main`, so Stam should validate against the stable,
versioned v1.2.0 schemas initially.

Relevant natural mappings:

| Stam | OCF v1.2.0 |
| --- | --- |
| Shareholder | `Stakeholder` |
| Share class | `StockClass` |
| Issue | `TX_STOCK_ISSUANCE` |
| Transfer | `TX_STOCK_TRANSFER` plus resulting issuances |
| Cancellation | `TX_STOCK_CANCELLATION` |
| Reversal of an issuance | Limited mapping to `TX_STOCK_RETRACTION` |
| Number ranges | `ShareNumberRange` on stock issuances |

Important mismatches:

- OCF has no general correction transaction.
- OCF has no opening-state transaction for an unknown earlier history.
- Stable OCF does not retain shareholder name, address, or identifier history.
- Transfer and cancellation objects do not directly carry number ranges; exact
  ranges must be propagated through resulting issuance objects.
- Transfer reasons such as gift and inheritance have no structured mapping.
- `StockClass` requires US-oriented common/preferred and seniority fields.
- OCF stock issuance requires a share price, which an opening state may not
  contain.
- OCF does not contain every Swedish share-certificate or statutory restriction
  annotation.
- JSON Schema validation does not enforce references, lifecycle integrity,
  range conservation, or positive integral share numbers.

OCF therefore remains an interchange adapter and does not own domain rules.

Proposed boundary:

```ts
interface OcfImportAdapter {
  analyze(input: OcfPackage): Promise<OcfImportReport>;
  toCommands(
    report: OcfImportReport,
    resolutions: ImportResolutions,
  ): DomainCommand[];
}

interface OcfExportAdapter {
  export(
    source: ShareRegisterSnapshot | EventHistory,
    options: OcfExportOptions,
  ): Promise<OcfExportResult>;
}
```

Import analysis performs no writes. It reports supported objects, warnings,
fatal issues, and proposed domain commands. Committing those commands goes
through the normal transactional application service.

The first OCF profile will:

- Accept `Stakeholder`, `StockClass`, numbered `StockIssuance`, recognized
  `StockTransfer`, and `StockCancellation` objects.
- Require exact positive share-number ranges.
- Validate cross-file identifiers and the complete security lifecycle.
- Reject unsupported securities and transaction types.
- Require users to resolve missing or ambiguous transfer reasons.
- Keep transaction-history imports distinct from opening-snapshot imports.
- Export only where mandatory OCF data can be represented accurately.
- Report every known loss of application audit or Swedish-specific information.
- Never invent prices, ownership, or transaction semantics.

Primary references:

- [Open Cap Table Format repository](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF)
- [OCF v1.2.0 release](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/releases/tag/v1.2.0)
- [OCF architecture](https://github.com/Open-Cap-Table-Coalition/Open-Cap-Format-OCF/blob/main/docs/explainers/Architecture.md)
- [Swedish Companies Act, Chapter 5](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/aktiebolagslag-2005551_sfs-2005-551/#K5)

## Milestones

### Milestone 1: Foundation (complete)

- Initialize the Bun, Hono, React, and strict TypeScript project.
- Add Biome, build scripts, test scripts, and dependency pinning.
- Add committed Drizzle migrations and the SQLite lifecycle.
- Add the multi-stage Docker image, one-service Compose file, `/data` volume
  convention, health check, and graceful shutdown.
- Integrate Better Auth with local sessions, passkeys, bootstrap administration,
  invitation links, and protected routes.
- Add company, shareholder, and share-class persistence.
- Implement immutable event schemas and append-only database protection.
- Implement the pure range and projection engine.
- Implement transactional event append and current projection rebuild.
- Add a minimal Swedish login, invitation, and authenticated shell UI built on
  the design system.
- Document architecture, self-hosting, migration, and backup assumptions.

Milestone 1 verification includes:

- Opening allocation.
- Full and partial transfers.
- Range splitting and coalescing.
- Multiple sequential transfers.
- New issuance and cancellation.
- Effective-time and registration-time historical projections.
- Invalid transfer by a non-owner.
- Overlapping issuance.
- Correct and invalid reversals.
- Shareholder-detail change and reversal.
- Multiple share classes.
- Backdated event validation.
- SQLite rollback after an invalid append.
- Concurrent append serialization.
- Event update/delete trigger enforcement.
- Property tests for non-overlap and share-count conservation.
- Better Auth session protection and one-time invitation consumption.

### Milestone 2: Core workflows (complete)

- Add manual opening-state import and its review step.
- Add the company list and company switcher.
- Add shareholder and share-class setup workflows.
- Add issuance, transfer, cancellation, and correction forms.
- Add immutable event-history views.
- Add current and historical share-register views.
- Build every view on the established design system.

Milestone 2 verification includes:

- Authenticated routing, password/passkey login, and invitation acceptance.
- Company creation, listing, and URL-driven switching.
- Shareholder and share-class setup with exact-decimal vote values.
- Non-writing server preview with no event, status, or projection side effects.
- Multi-holding opening-state review before explicit registration.
- Previewed issuance, transfer, cancellation, and reversal workflows.
- Immutable sequence-ordered event history with corrected-event status.
- Current register rendering with historical shareholder details and class totals.
- Historical register cutoffs for both effective date and registration time.
- Swedish design-system controls, semantic tables, and visible snapshot cutoffs.

### Milestone 3: OCF interoperability (complete)

- Add stable v1.2.0 schema validation.
- Add dry-run import reports and explicit issue resolution.
- Map the supported transaction subset into domain commands.
- Commit accepted imports atomically.
- Add supported-subset OCF export with validation and an export report.
- Test supported mappings and explicit rejection of unsupported transactions.

Milestone 3 verification includes all 168 official stable v1.2.0 schemas,
non-writing reports, server-enforced transfer resolutions, lifecycle/range
conservation, atomic rollback, snapshot/history separation, validated export,
information-loss reporting, and explicit rejection of unrepresentable objects
or event histories.

### Milestone 4: Operational completeness (complete)

- Add a separate append-only application audit log for invitations, login-related
  administration, configuration, imports, exports, and backup operations.
- Add backup and restore commands with documented verification.
- Add Swedish share-register HTML rendering.
- Add a Typst PDF/A renderer driven only by a self-contained export snapshot
  derived from `ShareRegisterSnapshot`.
- Record export audit entries without changing domain events.

Milestone 4 verification includes:

- Database-enforced immutability for application audit entries.
- Auditing of authentication outcomes, administration, invitations, safe runtime
  configuration changes, opening imports, exports, backups, and restores without
  recording credentials, invitation tokens, secrets, or database paths.
- Live-WAL backup with integrity verification, SHA-256 reporting, and audit entry.
- Offline restore verification, staged migration, current-database preservation,
  atomic replacement, sidecar cleanup, post-install verification, and audit entry.
- Cutoff-specific Swedish HTML export with escaped persisted values and print CSS.
- Snapshot-only Typst PDF/A export with Swedish register data, automatic
  pagination, repeating table headers, and owner overview.
- Audited HTML/PDF generation without appending or changing ownership events.

### Feature roadmap

This roadmap is directional rather than an implemented API contract. New
features should continue to distinguish the legally effective share register
from drafts, simulations, meeting material, and potential future equity.

Recommended sequence:

1. Add historical comparison between two effective/knowledge cutoffs. Explain
   changes in owners, shares, voting power, capital, and share classes, and link
   each difference to the events that caused it.
2. Generate a proposed voting register for a general meeting and chosen record
   date. Include shares, voting power, attendance, representatives, proxies,
   excluded votes, and a meeting-ready PDF export.
3. Add an explicitly non-binding transaction workspace for proposed issues,
   transfers, splits, and capital changes. Show dilution, voting impact,
   resulting ranges, and before/after ownership before an approved draft is
   promoted into immutable events.

Further product opportunities:

- Add an owner-focused view with current holdings, voting power, contact
  details, historical changes, documents, certificates, and positions across
  companies managed in Stam.
- Add a register-health dashboard for missing or stale owner details,
  zero-vote classes, unusual ownership concentration, missing evidence, and
  changes awaiting review.
- Add maker-checker approval so one user can prepare a change and another can
  review its consequences, evidence, and comments before registration.
- Link board resolutions, subscription lists, transfer agreements, and meeting
  minutes immutably to the events they support.
- Reconcile later Fortnox or OCF imports against the live register and explain
  discrepancies instead of treating every source as a new opening state.
- Add a meeting simulator for attendance and voting thresholds without changing
  the register.
- Visualize legal-entity ownership relationships, cross-holdings, and circular
  ownership without claiming unsupported beneficial-owner conclusions.
- Add restricted shareholder self-service for viewing holdings and proposing
  contact-detail changes subject to approval.
- Extend the authenticated agent API with webhooks and signed snapshots for
  accounting, legal, and investor-system integrations.

### Options and potential equity

Options fit the broader product, but not as holdings in the statutory share
register before exercise. The term also covers instruments with different legal
and economic behavior: employee options may be contractual rights, warrants
may be separately issued securities, and synthetic programs may settle in cash.
None should be approximated as issued shares or current voting power.

If Stam expands beyond the share-register boundary, implement potential equity
as a separate immutable instrument ledger with:

- Plan and instrument terms, grant recipients, quantities, strike prices,
  vesting, expiry, cancellation, exercise, and supporting documents.
- Separate views for issued ownership and fully diluted scenarios, with the
  assumptions behind every dilution calculation visible.
- No ownership or voting rights before actual share issuance unless an
  instrument's explicitly modeled legal terms require otherwise.
- An exercise workflow that validates the corporate action and then creates a
  normal share-issuance event. The option or warrant record should link to that
  event rather than mutating the share register directly.
- Explicit handling of unsupported instrument types and OCF transactions rather
  than coercing them into shares, transfers, or generic options.

A useful first increment is dilution-only planning for an option pool and
individual grants. Instrument administration, vesting, tax treatment, and
exercise automation should follow only after the relevant Swedish legal and
accounting requirements have been specified and reviewed.

### Later work

- Add supporting documents as immutable event-to-document links.
- Revalidate exact statutory Swedish fields and annotations.
- Consider a PostgreSQL adapter only if deployment requirements outgrow a
  single SQLite-backed application replica.
- Consider global user roles beyond invitation administration only when a
  concrete requirement exists.

## Deliberate deferrals

The following are not architecture placeholders. They are intentionally absent
until requirements justify them:

- Company memberships or per-company authorization.
- Tenant and organization abstractions.
- Generic policy engines.
- Microservices or asynchronous event infrastructure.
- PostgreSQL support.
- Mutable current-ownership CRUD APIs.
- Full OCF coverage.
- Advanced securities, fundraising, options, or governance workflows.
- Document management in the first milestones.
