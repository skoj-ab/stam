# HTTP API

## Conventions

The server exposes JSON under `/api`. `/api/health` and the authentication flow
are public as described below; every other application endpoint requires either
a valid Better Auth session cookie or a user-owned API key. Every authenticated
user can access and mutate every company except for permanent company removal.
Only a user whose comma-separated global `role` contains `admin` can list users
and invitations, create invitations, or permanently remove a company.

Requests and responses use `Content-Type: application/json`. IDs are opaque
strings. Dates are `YYYY-MM-DD`; timestamps are UTC ISO 8601 strings. Unknown
object properties are rejected on application write contracts. Numeric share
ranges use positive safe integers, while exact decimal values such as votes and
prices are JSON strings.

Non-`GET`/`HEAD`/`OPTIONS` application requests authenticated by a session cookie
must include an `Origin` header exactly matching `PUBLIC_ORIGIN`, or they return:

```json
{ "error": "Forbidden origin" }
```

Validated API-key requests do not require `Origin`; send the key in `x-api-key`.
Authentication routes apply Better Auth's own trusted-origin/CSRF handling and
never accept API keys. Browser clients must send cookies (`credentials:
"include"` when cross-fetch defaults would omit them). Production browser use
is same-origin only.

Common application failures are:

| Status | Body |
| --- | --- |
| `400` | `{ "error": "Invalid request", "issues"?: [...] }` |
| `401` | `{ "error": "Unauthorized" }` |
| `403` | Better Auth error or `{ "error": "Forbidden origin" }` |
| `404` | `{ "error": "<resource> not found: <id>" }` or `{ "error": "Not found" }` |
| `409` | `{ "error": "...", "code"?: "..." }` |
| `500` | `{ "error": "Internal server error" }` |

## Health and session

### `GET /api/health`

Public. Executes a SQLite `SELECT 1`.

```json
{ "status": "ok", "timestamp": "2026-08-28T12:00:00.000Z" }
```

### `GET /api/session`

Returns the minimum session and user identity required by the application. It
never returns a session token or API-key secret:

```json
{
  "session": {
    "id": "...",
    "expiresAt": "..."
  },
  "user": {
    "id": "...",
    "name": "Administrator",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

An API-key-authenticated response uses the API-key ID as `session.id`, but still
omits the secret.

## Authentication

Stam mounts Better Auth 1.7.2 at `/api/auth/*` with email/password, admin,
passkey, and API-key plugins. Public sign-up at
`POST /api/auth/sign-up/email` is disabled.
These are the supported Milestone 1 flow contracts:

### `POST /api/auth/sign-in/email`

```json
{
  "email": "admin@example.com",
  "password": "the-password",
  "rememberMe": true
}
```

`rememberMe` is optional and defaults to `true`. Success is `200`, sets the
session cookie, and returns `{ "redirect": false, "token": "...", "url": null,
"user": { ... } }`.

### `GET /api/auth/get-session`

Returns `{ "session": { ... }, "user": { ... } }` for a valid cookie and JSON
`null` without one. The response disables caching.

### `POST /api/auth/sign-out`

The body is optional; send `{}`. Deletes the current database session, expires
the cookie, and returns `{ "success": true }`.

### API-key authentication

API keys are user-owned credentials. They have exactly the current application
permissions and global role of the owning user; there are no API-specific scopes
or company grants. A key owned by an administrator can therefore use Stam's
application-level administrator operations. Prefer a dedicated non-admin user
for autonomous agents that do not need those operations.

Create, list, and revoke keys from **API-nycklar** in the authenticated account
menu. The UI creates named keys that expire after one year. Better Auth stores
only a SHA-256 hash and returns the full key once at creation. Requests are
limited to 600 per minute per key.

Send the key to application endpoints as:

```http
x-api-key: stam_...
```

API keys are deliberately removed before requests reach `/api/auth/*`. A key
cannot manage users, sessions, passkeys, passwords, or API keys through Better
Auth. Key creation, listing, and revocation require an ordinary session cookie.

### `GET /api/agent`

Returns `stam-agent-api-v1`, a cache-disabled machine-readable description of
the application API. It identifies the authentication method and owning user
role, states application conventions, and lists only operations available to
that role. For example, administrator-only invitation and company-removal
operations are omitted for a regular user's key. No credential secret is
included.

### Passkey authentication

1. `GET /api/auth/passkey/generate-authenticate-options` returns standard
   `PublicKeyCredentialRequestOptionsJSON` and sets a signed challenge cookie.
2. Call `navigator.credentials.get()` through the Better Auth passkey client.
3. `POST /api/auth/passkey/verify-authentication` with
   `{ "response": <AuthenticationResponseJSON> }`, the challenge cookie, and the
   configured origin. Success sets a session cookie and returns
   `{ "session": { ... }, "user": { ... } }`.

The generated options and verification must run in one browser cookie context.

## Invitation and passkey flow

### `GET /api/admin/directory`

Requires a global administrator and returns all users plus invitation history.
Invitation status is derived at the response's `asOf` timestamp as `PENDING`,
`CONSUMED`, or `EXPIRED`; consumed takes precedence after an invitation's expiry.
Roles are the target user's current roles, not a historical invitation value.
The response is `private, no-store` and never includes invitation tokens or
hashes.

```json
{
  "asOf": "2026-08-29T12:00:00.000Z",
  "users": [
    {
      "id": "...",
      "name": "Invited User",
      "email": "invitee@example.com",
      "roles": ["user"],
      "accessStatus": "ACTIVE",
      "createdAt": "2026-08-29T11:45:00.000Z",
      "removable": true
    }
  ],
  "invitations": [
    {
      "id": "...",
      "userId": "...",
      "email": "invitee@example.com",
      "name": "Invited User",
      "roles": ["user"],
      "status": "PENDING",
      "createdAt": "2026-08-29T11:45:00.000Z",
      "expiresAt": "2026-08-29T12:00:00.000Z",
      "consumedAt": null,
      "createdBy": "...",
      "createdByName": "Administrator"
    }
  ]
}
```

`removable` is false for the requesting administrator's own account.

### `DELETE /api/admin/users/:userId`

Requires a global administrator and permanently removes another user. The
operation returns `204`, invalidates the user's sessions, passwords, passkeys,
and API keys, and removes invitations owned or created by that user. Immutable
application and audit records retain the removed user's ID. Administrators
cannot remove their own account (`409`); an unknown user returns `404`.

### `POST /api/admin/invitations`

Requires a global administrator.

```json
{
  "email": "invitee@example.com",
  "name": "Invited User",
  "expiresAt": "2026-08-28T12:15:00.000Z"
}
```

`expiresAt` is optional, must be a future UTC timestamp without a numeric offset,
and defaults to 15 minutes after creation. Email is trimmed and lowercased. The
response is `201`:

```json
{
  "invitation": {
    "id": "...",
    "userId": "...",
    "email": "invitee@example.com",
    "name": "Invited User",
    "expiresAt": "2026-08-28T12:15:00.000Z",
    "createdAt": "2026-08-28T12:00:00.000Z",
    "createdBy": "...",
    "consumedAt": null
  },
  "token": "opaque-base64url-token",
  "acceptanceUrl": "https://stam.example.com/accept-invitation?token=..."
}
```

Only the token hash is stored. Deliver the response token through a protected
channel. Re-inviting the same email/name reuses the pending user and creates a
new token. A different name for an existing email returns `409` with code
`INVITATION_IDENTITY_MISMATCH`. The acceptance URL opens the application route
that registers a named passkey and establishes the invited user's session.

Invitation enrollment uses these exact HTTP steps:

1. `GET /api/auth/passkey/generate-register-options?context=<token>` with the
   browser `Origin`. It validates the unconsumed token and returns standard
   `PublicKeyCredentialCreationOptionsJSON`; the returned `user.name` is the
   email and `user.displayName` is the invitation name. It also sets a signed
   challenge cookie.
2. Call `navigator.credentials.create()` through the Better Auth passkey client.
3. `POST /api/auth/passkey/verify-registration` with the same cookie and origin:

```json
{
  "response": "<RegistrationResponseJSON object>",
  "name": "Work laptop",
  "createSession": true
}
```

`name` and `createSession` are optional. Set `createSession: true` for acceptance
to establish a login session. Successful WebAuthn verification stores the
passkey and atomically consumes the invitation. Reuse, expiry, invalid context,
or identity mismatch returns `400` with one of `CONSUMED_INVITATION`,
`EXPIRED_INVITATION`, `INVALID_INVITATION`, or `INVITATION_USER_MISMATCH`.

Use `authClient.passkey.addPasskey({ context: token, createSession: true })` from
the configured Better Auth client instead of manually translating WebAuthn
binary fields in UI code.

## Companies

The company response shape is:

```json
{
  "id": "...",
  "legalName": "Example AB",
  "registrationCountry": "SE",
  "registrationScheme": "ORGANISATIONSNUMMER",
  "registrationValue": "5500000038",
  "status": "DRAFT",
  "createdAt": "2026-08-28T12:00:00.000Z",
  "createdBy": "user-id"
}
```

`status` becomes `ACTIVE` when a valid opening-state event is appended.

### `GET /api/companies`

Returns `200` with a JSON array ordered by legal name then ID.

### `POST /api/companies`

```json
{
  "legalName": "Example AB",
  "registrationCountry": "SE",
  "registrationScheme": "ORGANISATIONSNUMMER",
  "registrationValue": "550000-0038",
  "initialShareClass": {
    "name": "A",
    "votesPerShare": "1",
    "effectiveFrom": "2026-08-28"
  }
}
```

`initialShareClass` is optional. When supplied, the company and share class are
created atomically. Country is exactly two uppercase letters. Returns the company
with `201`. Registration country/scheme/value must be globally unique. Swedish
organization numbers using the `ORGANISATIONSNUMMER` scheme must pass the Luhn
check and may be entered with or without a hyphen. They are stored and returned
as ten digits without a separator; human-facing views add the hyphen before the
final four digits.

### `GET /api/companies/:companyId`

Returns the company with `200`, or `404`.

### `DELETE /api/companies/:companyId`

Requires a global administrator and returns `204`. Authorization is checked
before the company lookup, so a non-administrator receives `403` for both known
and unknown IDs. Both `DRAFT` and `ACTIVE` companies can be removed.

The company and all owned shareholders, share classes, share events, and current
projection rows are deleted by one atomic parent cascade. Direct deletion of the
immutable child rows remains blocked by database triggers. Existing application
audit rows are retained, and a successful `COMPANY_REMOVED` audit event is
inserted in the same transaction. Its payload is empty; it contains only the
standard actor, company/target IDs, operation ID, and timestamp metadata. If the
audit insert fails, the complete deletion is rolled back.

### `POST /api/companies/imports/fortnox/preview`

Validates three Fortnox exports and prepares a complete new-company bootstrap
without writing to the database. The preferred request is `multipart/form-data`
with the files available directly from Fortnox:

| Field | File |
| --- | --- |
| `detailedRegisterPdf` | The **Aktiebok** PDF from **Rapporter** |
| `ownerOverviewPdf` | The **Ägaröversikt** PDF from **Rapporter** |
| `eventsHtml` | The browser-saved page from **Händelser** (`.html` or `.htm`) |

Each file is limited to 5 MiB and the complete request is limited to 10 MiB.
The PDF reports must contain selectable text; image-only scans are not accepted.
The server extracts text with `pdftotext -layout` and then applies the same
strict parser and reconciliation checks as before.

Machine clients may alternatively submit already extracted sources as JSON:

```json
{
  "detailedRegisterText": "<text extracted from the detailed register PDF>",
  "ownerOverviewText": "<text extracted from the owner overview PDF>",
  "eventsHtml": "<saved Fortnox event-history HTML>"
}
```

When JSON is used, PDF text must retain the source column layout, for example
output from `pdftotext -layout`. The combined request is limited to 10 MiB.

Success returns `200` with `plan` and a provisional `currentSnapshot`. The plan
contains the normalized company, one reconciled share class, structured current
shareholders, current numbered holdings, current capital derived from the
detailed register, all parsed source events, and reconciliation warnings.
Preview IDs are provisional and no rows or audit events are written.

### `POST /api/companies/imports/fortnox`

Accepts the same multipart files or extracted JSON request, parses and validates
it again, and returns `201` with:

```json
{
  "plan": "<same normalized plan shape as preview>",
  "company": "<active company>",
  "shareholders": ["<created shareholders>"],
  "shareClasses": ["<created share class>"],
  "events": ["<persisted import events>"],
  "currentSnapshot": "<current snapshot>"
}
```

Company, catalogs, immutable events, current projections, activation, and the
`IMPORT_COMMITTED` audit event are written in one immediate SQLite transaction.
Every Fortnox activity is retained as `SOURCE_ACTIVITY_RECORDED`; free-text
activity descriptions are not converted into ownership changes. The verified
PDF holdings become one `OPENING_STATE_IMPORTED` event, and the displayed
current capital becomes `SHARE_CAPITAL_CHANGED`. Unknown pre-export numbered
ranges are never inferred. A canonical duplicate organization number returns
`409`; malformed or unsafe-to-map source data returns `400`.

### `POST /api/companies/imports/ocf/preview`

Validates a parsed OCF package against the complete official stable v1.2.0
schema bundle and analyzes the supported Swedish stock profile without writing
anything. The request is limited to 10 MiB:

```json
{
  "package": {
    "manifest": { "ocf_version": "1.2.0", "file_type": "OCF_MANIFEST_FILE" },
    "files": {
      "./Stakeholders.ocf.json": { "file_type": "OCF_STAKEHOLDERS_FILE", "items": [] },
      "./StockClasses.ocf.json": { "file_type": "OCF_STOCK_CLASSES_FILE", "items": [] },
      "./Transactions.ocf.json": { "file_type": "OCF_TRANSACTIONS_FILE", "items": [] }
    }
  },
  "options": {
    "mode": "TRANSACTION_HISTORY",
    "transferReasonResolutions": {
      "source-transfer-id": { "reason": "SALE" }
    }
  }
}
```

`files` is keyed by the exact paths referenced by the manifest. The transport
contains parsed JSON, not a ZIP archive or original bytes, so manifest MD5
values are schema-validated but cannot be recalculated during import. `mode` is
`TRANSACTION_HISTORY` or `OPENING_SNAPSHOT`. Transfer reasons are keyed by the
source transaction ID and use `SALE`, `GIFT`, `INHERITANCE`,
`DIVISION_OF_PROPERTY`, or `OTHER`.

The `200` response contains `report` and, when valid, `conversion`. The report
has stable file/object/JSON-path issues, information-loss entries, supported
object counts, required resolutions, and deterministic proposed commands. A
report can therefore return `200` with `valid: false`; preview never creates a
company, catalog row, event, projection, or audit entry.

The first profile accepts a Swedish issuer and Swedish individual/institution
stakeholders, stock classes, numbered `TX_STOCK_ISSUANCE`, recognized
`TX_STOCK_TRANSFER` lineages, and `TX_STOCK_CANCELLATION`. It requires complete
positive integral share ranges, exact range conservation, valid cross-file
references, and a complete acyclic security lifecycle. Unsupported securities,
stock-plan/vesting terms, transaction types, broken references, duplicate IDs,
and unresolved transfer reasons are explicit errors rather than silently
dropped data.

### `POST /api/companies/imports/ocf`

Accepts the same body, repeats the complete analysis inside an immediate SQLite
transaction, and creates a new company. A valid transaction-history import uses
an empty OCF opening marker followed by mapped issuance, transfer, and
cancellation events. Snapshot mode imports only terminal holdings and reports
every collapsed source transaction as information loss.

Company, shareholders, share classes, immutable events, projections,
activation, and the safe `IMPORT_COMMITTED` audit entry are atomic. Success
returns `201` with the report, active company, catalogs, persisted events, and
current snapshot. Invalid or unresolved reports return `422` with the complete
report and no writes. Duplicate company identifiers return `409`.

## Shareholders

### `GET /api/companies/:companyId/shareholders`

Returns all company shareholders ordered by registration timestamp then ID.

### `GET /api/companies/:companyId/shareholder-copy-candidates`

Returns current shareholder details from other companies for copy-assisted
creation. Owners whose normalized identifier already exists in the target
company are excluded. Selecting a candidate does not create a cross-company
link; the ordinary shareholder creation endpoint stores an independent copy.

### `POST /api/companies/:companyId/shareholders`

The path supplies `companyId`; a body `companyId` is overwritten by the path.

```json
{
  "kind": "INDIVIDUAL",
  "identifierCountryCode": "SE",
  "identifierScheme": "PERSONNUMMER",
  "identifierValue": "811218-2392",
  "initialDetails": {
    "legalName": "Alice Andersson",
    "emailAddress": "alice@example.com",
    "phoneNumber": "+46 70 123 45 67",
    "address": {
      "lines": ["Example street 1"],
      "postalCode": "111 11",
      "locality": "Stockholm",
      "countryCode": "SE"
    }
  },
  "effectiveFrom": "2024-01-01"
}
```

`kind` is `INDIVIDUAL` or `LEGAL_ENTITY`. Swedish person-/organisation numbers
are immutable first-class attributes, may be entered with or without a hyphen,
are normalized to ten digits, and are unique within the company. The same
normalized identifier may belong to separate shareholder records in different
companies. `emailAddress` and `phoneNumber` are optional.
Returns `201` with the input plus `id`, `companyId`, `registeredAt`, and
`registeredBy`. Shareholder rows are immutable; later details are events.

### `GET /api/companies/:companyId/shareholders/:shareholderId/company-matches`

Returns the company-local shareholder records that have the same canonical
identifier as the selected shareholder. Each match includes the company summary,
its independent shareholder ID, and its current projected details:

```json
[
  {
    "company": {
      "id": "company-id",
      "legalName": "Example AB",
      "registrationValue": "5500000004"
    },
    "shareholderId": "shareholder-id",
    "details": {
      "legalName": "Alice Andersson",
      "address": {
        "lines": ["Example street 1"],
        "postalCode": "111 11",
        "locality": "Stockholm",
        "countryCode": "SE"
      }
    }
  }
]
```

### `POST /api/companies/:companyId/shareholders/:shareholderId/details-changes/preview`

Validates and previews one details-change event for each selected matching
company without persisting anything:

```json
{
  "targetCompanyIds": ["current-company-id", "other-company-id"],
  "effectiveDate": "2024-05-01",
  "after": {
    "legalName": "Alice Updated",
    "emailAddress": "alice@example.com",
    "phoneNumber": "+46 70 123 45 67",
    "address": {
      "lines": ["New street 2"],
      "postalCode": "222 22",
      "locality": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

`targetCompanyIds` must be unique and must include the company in the path.
Every target must contain a company-local shareholder with the anchor
shareholder's canonical identifier. Returns `200` with `results`; each result
contains the company summary, its shareholder ID, and the proposed event.

### `POST /api/companies/:companyId/shareholders/:shareholderId/details-changes`

Accepts the same body as the preview endpoint and returns the same result shape
with `201`. It appends one independent `SHAREHOLDER_DETAILS_CHANGED` event per
selected company. All events have one shared `operationId` and registration
timestamp, and all selected company updates commit or roll back in one database
transaction. Unselected matching companies are unchanged.

## Share classes

### `GET /api/companies/:companyId/share-classes`

Returns all classes ordered by name then ID.

### `POST /api/companies/:companyId/share-classes`

```json
{ "name": "A", "votesPerShare": "1", "effectiveFrom": "2024-01-01" }
```

`votesPerShare` is a non-negative decimal string without exponent or sign.
Returns `201` with the input plus `id`, `companyId`, `registeredAt`, and
`registeredBy`. Class names are unique within a company.

## Share events

### `GET /api/companies/:companyId/events`

Returns all immutable events in company sequence order. Every returned event has:

```json
{
  "id": "...",
  "companyId": "...",
  "sequence": 1,
  "schemaVersion": 1,
  "effectiveDate": "2024-01-01",
  "registeredAt": "2026-08-28T12:00:00.000Z",
  "registeredBy": "user-id",
  "operationId": "batch-id",
  "type": "OPENING_STATE_IMPORTED",
  "payload": {}
}
```

### `POST /api/companies/:companyId/events`

Accepts a non-empty JSON array. The server allocates IDs, sequence, schema
version, registration metadata, and one operation ID for the batch. Each draft is:

```json
{ "effectiveDate": "2024-01-01", "type": "EVENT_TYPE", "payload": {} }
```

Payload contracts by type:

`OPENING_STATE_IMPORTED`:

```json
{
  "holdings": [
    {
      "shareholderId": "...",
      "shareClassId": "...",
      "ranges": [{ "from": 1, "to": 100 }]
    }
  ],
  "sourceType": "SHARE_REGISTER",
  "importNote": "Verified opening register"
}
```

`sourceType` is `SHARE_REGISTER`, `OCF`, or `OTHER`. Holdings must be non-empty,
except for the empty OCF marker used to bootstrap a complete transaction-history
import before its first issuance.

`SHARES_ISSUED`:

```json
{
  "shareholderId": "...",
  "shareClassId": "...",
  "ranges": [{ "from": 101, "to": 120 }],
  "subscriptionPrice": { "amount": "10.50", "currency": "SEK" }
}
```

`subscriptionPrice` is optional; currency is exactly three uppercase letters.

`SHARES_TRANSFERRED`:

```json
{
  "transferorId": "...",
  "transfereeId": "...",
  "shareClassId": "...",
  "ranges": [{ "from": 1, "to": 10 }],
  "reason": "SALE",
  "reasonNote": "Optional details"
}
```

`reason` is `SALE`, `GIFT`, `INHERITANCE`, `DIVISION_OF_PROPERTY`, or `OTHER`.
`reasonNote` is optional.

`SHARES_CANCELLED`:

```json
{
  "shareholderId": "...",
  "shareClassId": "...",
  "ranges": [{ "from": 11, "to": 20 }],
  "reason": "CANCELLATION",
  "reasonNote": "Optional details"
}
```

`reason` is `REDEMPTION`, `CANCELLATION`, or `OTHER`.

`SHAREHOLDER_DETAILS_CHANGED`:

```json
{
  "shareholderId": "...",
  "after": {
    "legalName": "Alice Andersson",
    "emailAddress": "alice@example.com",
    "phoneNumber": "+46 70 123 45 67",
    "address": {
      "lines": ["New street 2"],
      "postalCode": "222 22",
      "locality": "Stockholm",
      "countryCode": "SE"
    }
  }
}
```

The server derives and stores `before`. Identifiers are not part of shareholder
details and cannot be changed by this event. `emailAddress` and `phoneNumber` are optional. Omit
either field to remove that contact detail.

`SHARE_CAPITAL_CHANGED` stores exact `before`/`after` money, where `before` is
optional, plus reason `FORMATION`, `ISSUE`, `BONUS_ISSUE`, `REDUCTION`, or
`OTHER`. `SHARES_SPLIT` stores an integer factor of at least two.
`SHARES_RENUMBERED` stores a complete replacement holding set and must conserve
the exact share count for each shareholder and class. `SOURCE_ACTIVITY_RECORDED`
stores a source ID, category, description, and optional structured source data;
it changes no ownership projection. These four structural/provenance events are
not reversible.

`EVENT_REVERSED`:

```json
{ "targetEventId": "...", "explanation": "Registered in error" }
```

Ranges are inclusive, positive safe integers. Ranges in a command cannot
overlap. All referenced shareholders/classes must belong to the company, and
the complete effective-time stream must remain valid. Domain conflicts return
`409` with a stable code such as `INVALID_OWNERSHIP`.

Success returns `201`:

```json
{
  "events": ["<complete persisted event>"],
  "currentSnapshot": "<snapshot contract below>"
}
```

The complete batch and current materialized projection update in one immediate
SQLite transaction.

### `POST /api/companies/:companyId/events/preview`

Accepts the same non-empty draft batch and applies the same candidate
construction, derived fields, and complete-stream validation as the append
endpoint. Success returns `200` with the same `events` and `currentSnapshot`
shape shown above.

Preview event IDs and registration metadata are provisional and are not
reserved for a later append. Preview does not append event history, change the
company from `DRAFT` to `ACTIVE`, or rebuild the current projection tables.
Domain conflicts return the same `409` response as an append of the batch.

## Snapshots

### `GET /api/companies/:companyId/snapshot`

Returns the snapshot effective today using all currently known events.

### `GET /api/companies/:companyId/snapshot/history`

Optional query parameters:

- `effectiveOn=YYYY-MM-DD`: ownership effective cutoff.
- `knownAt=<UTC ISO timestamp>`: registration-time knowledge cutoff.

Unknown query parameters are rejected. The response is:

```json
{
  "companyId": "...",
  "effectiveOn": "2024-12-31",
  "knownAt": "2026-08-28T12:00:00.000Z",
  "holdings": [
    {
      "shareholderId": "...",
      "shareClassId": "...",
      "range": { "from": 1, "to": 100 }
    }
  ],
  "shareholderDetails": [
    { "shareholderId": "...", "details": "<shareholder details object>" }
  ],
  "totalsByClass": [{ "shareClassId": "...", "total": 100 }],
  "totalsByShareholder": [{ "shareholderId": "...", "total": 100 }],
  "appliedEventIds": ["..."],
  "lastAppliedSequence": 1
}
```

Optional cutoff/sequence fields can be omitted when not applicable. Historical
results are derived by deterministic event replay; clients must not infer them
from only the current projection tables.

## Share-register exports

### `GET /api/companies/:companyId/share-register/export/html`

Returns a downloadable Swedish HTML rendering of the share register. The
optional `effectiveOn` and `knownAt` query parameters have the same strict format
as the historical snapshot endpoint. Omitted values are fixed to the export
request time, so the rendered document always states both cutoffs.

The renderer consumes one self-contained export snapshot and performs no
database reads or clock access. Successful generation appends an
`EXPORT_GENERATED` application-audit event without changing ownership events.
The document explicitly warns that Stam does not yet store share-certificate or
articles-of-association restriction annotations.

### `GET /api/companies/:companyId/share-register/export/pdf`

Accepts the same cutoffs and renders the same self-contained snapshot as a
paginated PDF document. The PDF includes an owner overview with each owner's
postal address, email address, phone number, total shares, ownership percentage,
voting power, and voting percentage across all share classes. A bundled Typst
template produces PDF/A-2b with embedded fonts, automatic text wrapping,
repeating table headers, and page numbers on portrait A4 pages. The generation
timestamp appears only in the footer, formatted to seconds with the server's
IANA timezone and UTC offset. Success returns `application/pdf` with an
attachment filename and appends a separate `EXPORT_GENERATED` audit event.

### `POST /api/companies/:companyId/share-register/export/ocf`

Exports a faithfully representable event history as a parsed OCF v1.2.0 package
plus an export report:

```json
{
  "formationDate": "2019-01-01",
  "asOf": "2024-12-31",
  "stockClasses": {
    "stam-share-class-id": {
      "classType": "COMMON",
      "defaultIdPrefix": "A-",
      "initialSharesAuthorized": "1000",
      "seniority": "1"
    }
  }
}
```

OCF requires issuer formation and US-oriented stock-class metadata that Stam
does not store, so callers must provide it explicitly for each class effective
at `asOf`. Only an empty opening marker followed by priced issuances, transfers,
and cancellations is exportable. Populated opening states, unpriced issuances,
reversals, splits, renumbering, and corrections are rejected instead of being
invented or flattened. Shareholder-detail, source-provenance, and capital events
are reported as information loss because they do not alter the exported stock
lifecycle.

The generated package is validated against the official schemas and replayed
through the same lifecycle analyzer before it is returned. Success returns
`200`, appends one metadata-only `EXPORT_GENERATED` audit entry, and does not
change ownership events. An unrepresentable history returns `422` with the
report and no package or export audit entry.
