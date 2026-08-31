# Operations

## Milestone status

Milestones 1 through 4 are complete. The implemented system includes OCF v1.2.0
supported-profile interoperability, authentication, company and catalog
setup, reviewed opening imports, ownership events, immutable history, historical
projections, an append-only application audit log, verified backup/restore, and
audited HTML/PDF/OCF register exports. The production bundle serves the Swedish
application UI and invitation-acceptance route from the same origin as the API.

Fortnox import accepts the two PDF reports available under **Rapporter** and a
browser-saved HTML copy of **Händelser**. PDF extraction uses Poppler
`pdftotext -layout` with no temporary source files. The container installs
Poppler; local development hosts need `pdftotext` on `PATH` to exercise PDF
uploads. Each source file is limited to 5 MiB and extraction times out after 15
seconds.

## Application audit

The `application_audit_events` table is separate from ownership events and has
database triggers that reject updates and deletes. It records authentication and
administration outcomes, invitations, safe runtime-configuration changes,
committed opening imports, exports, backups, and restores. Exporting never changes
the ownership-event sequence.

Successful hard company removal records `COMPANY_REMOVED` with an empty payload.
The audit row retains only standard actor and operation metadata plus the removed
company's opaque ID; names, registration values, shareholder details, addresses,
and identifiers are not copied into it. Earlier audit rows for the company remain
append-only after the company data is removed.

Fortnox bootstrap audit payloads contain only the export date, aggregate counts,
warning codes, and persisted event IDs. Raw PDF text, HTML, owner names,
addresses, and identifiers are not copied into the application audit log. Parsed
Fortnox activities are instead retained in the company share-event stream as
immutable source provenance.

OCF import audit payloads contain the fixed OCF version, import mode, aggregate
supported-object count, and information-loss count. They do not contain the OCF
manifest, source files, names, addresses, tax IDs, or transaction payloads. OCF
export audit payloads contain only the format, as-of date, package digest, byte
size, and information-loss count. The full official v1.2.0 schema bundle is
loaded from the locked application dependency; validation does not require
network access at runtime.

Audit payloads omit passwords, session and invitation tokens, passkey material,
`AUTH_SECRET`, database paths, request bodies, and exported register contents.
The audit log is append-only within SQLite's application trust boundary; retain
verified off-host backups for protection against database replacement or an
operator able to remove triggers.

## Runtime configuration

| Variable | Development default | Production requirement |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3100` | Optional, `3100` in the image |
| `DATABASE_PATH` | `./data/stam.sqlite` | `/data/stam.sqlite` in Compose |
| `AUTH_SECRET` | Development-only value | Required, at least 32 characters |
| `AUTH_SECRET_FILE` | Unset | Alternative file containing `AUTH_SECRET` |
| `PUBLIC_ORIGIN` | `http://localhost:5174` | Required absolute HTTPS origin, without a path |
| `WEBAUTHN_RP_ID` | `localhost` | Required WebAuthn relying-party domain |

Generate `AUTH_SECRET` with a cryptographically secure generator, for example
`openssl rand -base64 48`. Do not commit it or pass it as a command argument.
Compose reads these three required public/runtime values from the shell or a
local `.env` file:

```bash
AUTH_SECRET=replace-with-a-secret-of-at-least-32-characters
PUBLIC_ORIGIN=https://stam.example.com
WEBAUTHN_RP_ID=stam.example.com
```

Configure only one of `AUTH_SECRET` and `AUTH_SECRET_FILE`. The file form reads
the secret at startup and removes one trailing line ending, which makes it
compatible with Docker Swarm secrets mounted under `/run/secrets`. It does not
put the secret in the service environment.

`PUBLIC_ORIGIN` is the browser-visible origin and is used for cookie, trusted
origin, CSRF, invitation URL, and WebAuthn checks. Production rejects HTTP.
`WEBAUTHN_RP_ID` is normally the exact hostname, with no scheme, port, or path.
It may be a registrable parent domain only when that is an intentional WebAuthn
deployment choice. Changing either value can break existing passkey ceremonies.

Compose publishes container port 3100 only on host loopback. Terminate HTTPS at
a reverse proxy on that host and preserve the external `Host`/origin semantics,
cookies, and `Origin` header. Do not expose a production HTTP origin directly.

## Local operation

Install and migrate with the exact supported runtime:

```bash
bun --version
typst --version
bun install --frozen-lockfile
cp .env.example .env
bun run db:migrate
```

The expected versions are Bun `1.4.0` and Typst `0.15.1`. Typst must be available
on `PATH` when running outside the container, and Liberation fonts should be
installed under `/usr/share/fonts/truetype/liberation`. `bun run dev` starts
the API and Vite application together. `bun run build && bun run start` serves
the production bundle on `PORT`; set `PUBLIC_ORIGIN` to that same
browser-visible origin.

Migrations are committed under `drizzle/`. The migration history was intentionally
re-baselined when shareholder identifiers became first-class unique columns;
databases and backups from before that baseline must be cleared rather than
migrated. `bun run db:migrate`, the first-admin
command, and server startup all apply outstanding migrations. Never edit an
already-deployed migration; add and review a new migration with
`bun run db:generate`.

## First administrator

On an empty database, browsing to `/`, `/login`, or `/setup` opens the initial
setup page. Enter the administrator's name, email address, and password. The
password must be 8 to 128 characters. Successful setup creates the global
administrator, signs it in, and closes the setup page while any user exists.
Public email/password sign-up remains disabled.

The setup page is deliberately unauthenticated. The first visitor who submits
it becomes the administrator. Complete setup immediately and do not leave a new
installation exposed unattended.

For unattended or local development setup, the command-line bootstrap remains
available:

```bash
STAM_ADMIN_EMAIL=admin@example.com \
STAM_ADMIN_NAME=Administrator \
STAM_ADMIN_PASSWORD='replace-with-a-strong-password' \
bun run auth:bootstrap
```

Keep command-line passwords out of shell history where possible and unset the
variables afterwards. Both setup paths serialize creation within one process,
check that the user table is empty, and refuse once the first user exists. Use
**Registrera passkey** in the authenticated account menu after setup.

An authenticated global administrator creates invitations with the **Användare
och inbjudningar** page or `POST /api/admin/invitations`. The returned token is
shown only in that response; the database stores its SHA-256 hash. The default
lifetime is 15 minutes. The recipient uses the token as the `context` for
passkey registration, and successful verification consumes it exactly once. See
[API](api.md#invitation-and-passkey-flow). The generated `/accept-invitation`
URL opens the passkey-enrollment UI and establishes a session after successful
registration.

Administrators can permanently remove another user from the same page or with
`DELETE /api/admin/users/:userId`. Removal immediately revokes all of that
user's sessions and credentials, including API keys, and removes invitations
owned or created by the user. The acting administrator cannot remove their own
account. Immutable application and audit records keep the removed user's ID.

Every authenticated user can create named, one-year API keys from the account
menu. A key inherits the owning user's current global role and all-company
access. Store the one-time displayed secret outside Stam, revoke unused keys,
and use a dedicated non-admin user for agents where possible. Keys authenticate
only Stam application endpoints through `x-api-key`; Better Auth account,
credential, and administration endpoints remain cookie-only. `GET /api/agent`
returns machine-readable documentation filtered to the key owner's role.

## Container deployment

The multi-stage image uses `oven/bun:1.4.0` for build and runtime. It contains
the built web application, bundled server and command entrypoints, migrations,
Typst `0.15.1`, and Liberation fonts. Typst release archives are selected for
amd64 or arm64 and verified by SHA-256 during the build. The process runs as the
base image's non-root `bun` user.

The public image is `ghcr.io/skoj-ab/stam`. Exact semantic versions are release
artifacts; `edge` tracks `main` and is intended for evaluation. Production
deployments should set `STAM_VERSION` to an exact release.

PDF exports compile a self-contained JSON snapshot through the bundled Typst
template into PDF/A-2b. Compilation runs as a one-job subprocess with a
15-second timeout. Its private temporary workspace is removed after success or
failure. A missing Typst executable or compilation failure rejects the export;
no audit success entry is written unless PDF bytes were produced.

The PDF footer formats its generation timestamp using the server process's
resolved timezone and prints both the IANA timezone name and UTC offset. The
container defaults to UTC unless its runtime timezone is configured differently.

```bash
export AUTH_SECRET="$(openssl rand -base64 48)"
export PUBLIC_ORIGIN=https://stam.example.com
export WEBAUTHN_RP_ID=stam.example.com
export STAM_VERSION=0.1.0
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f stam
```

To build the checkout instead of pulling GHCR, add the build override:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

The deployment is intentionally one service, one process, one replica, and one
named volume. `/data` must be a durable local Docker volume on the same host as
the process. Do not use NFS, SMB, object-storage mounts, distributed filesystems,
multiple containers sharing the file, or `docker compose up --scale stam=2`.
SQLite locking and WAL do not provide a multi-replica deployment model.

### Automatic HTTPS with Caddy

Caddy can obtain and renew a public certificate when the domain's `A`/`AAAA`
records point to the Docker host and inbound TCP ports 80 and 443 are open. UDP
443 enables HTTP/3 but is not required for certificate issuance.

```bash
docker compose -f compose.yaml -f compose.caddy.yaml up -d
```

The Caddy volumes retain account and certificate state. Caddy redirects HTTP to
HTTPS and proxies to Stam over the Compose network. Starting this configuration
immediately exposes the unauthenticated first-run setup page.

### Docker Swarm

Stam remains a single-replica SQLite service under Swarm. Choose one durable
node, label it, and create the local volume on that node:

```bash
docker node update --label-add stam-data=true DATA_NODE
docker volume create stam-data
```

Run `docker volume create` on `DATA_NODE` itself. The placement constraint keeps
the service attached to that node-local volume; Swarm rescheduling is not
database failover. Restore a verified backup before moving Stam to another
node.

Create the runtime secret from a manager without putting it in a service
environment:

```bash
openssl rand -base64 48 | docker secret create stam_auth_secret -
```

For an existing Swarm reverse proxy, create or reuse an attachable overlay
network named `stam-proxy`, connect the proxy to it, export the public settings,
and deploy:

```bash
docker network create --driver overlay --attachable stam-proxy
export PUBLIC_ORIGIN=https://stam.example.com
export WEBAUTHN_RP_ID=stam.example.com
export STAM_VERSION=0.1.0
docker stack deploy --compose-file stack.yaml stam
```

The stack publishes no application port; the existing proxy reaches service
`stam_stam` on port 3100 through `stam-proxy`.

For bundled Caddy, DNS and firewall prerequisites are the same as the Compose
variant. Create Caddy's node-local volumes on `DATA_NODE`, then deploy the
self-contained stack:

```bash
docker volume create caddy-data
docker volume create caddy-config
docker stack deploy --compose-file stack.caddy.yaml stam
```

Both stacks specify one replica, stop-first updates, a 30-second shutdown
window, and paused failed updates. Open `/setup` immediately after the service
becomes healthy. Backups must still be copied off the Swarm node.

The healthcheck calls `GET /api/health`, which executes `SELECT 1`. It proves the
process and SQLite connection respond; it is not an external dependency or
domain-data audit.

## SQLite durability

Every application connection sets:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

WAL permits readers during writes, `synchronous=FULL` favors committed-write
durability, and the busy timeout tolerates short write contention. These are not
a replacement for host, volume, and off-host backup durability.

On `SIGTERM` or `SIGINT`, the server stops accepting requests, waits for Bun's
HTTP server to stop, checkpoints the WAL with `TRUNCATE`, closes SQLite, and
exits. Compose allows 30 seconds before forced termination. Keep reverse-proxy
and orchestrator termination windows at least that long. A crash is recoverable
through SQLite WAL, but routine deploys should use graceful stop.

## Online backup

The backup command opens a separate read-only SQLite connection and uses
`Database.serialize()`, which includes committed data visible through a live WAL.
It writes a mode-`0600` temporary file beside the destination, runs
`PRAGMA integrity_check` against that file, and atomically renames it. It refuses
an existing destination and refuses the source path as the destination. It does
not read or print `AUTH_SECRET`.

Local backup while the server remains live:

```bash
STAM_BACKUP_PATH="./backups/stam-$(date -u +%Y%m%dT%H%M%SZ).sqlite" \
bun run db:backup
```

Equivalent explicit output:

```bash
bun run db:backup --output "./backups/stam-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Compose backup, also while live:

```bash
docker compose exec stam bun dist/server/backup.js \
  --output "/data/backups/stam-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

The backup initially lives on the same named volume and therefore is not enough
for host or volume loss. Copy it to encrypted, access-controlled off-host storage
and apply retention policy. The file contains user identities, credential hashes,
passkey public material, sessions, invitation hashes, and all register data.

Verify any transferred backup before relying on it:

```bash
BACKUP=./backups/stam-20260828T120000Z.sqlite bun -e '
  import { Database } from "bun:sqlite";
  const db = new Database(Bun.env.BACKUP, { readonly: true });
  console.log(db.query("PRAGMA integrity_check").all());
  db.close();
'
```

The expected output is one row whose `integrity_check` value is `ok`.

The command also prints the artifact SHA-256 digest and records a successful
backup operation in the append-only application audit log.

## Permanent company removal

Only a global administrator sees **Inställningar** for a selected company and can
use **Ta bort bolaget permanent**. The operation is available for both active
companies and drafts. It permanently removes the company, its complete immutable
share-event history, catalogs, and current projections and cannot be undone in
the application.

Create and verify an off-host backup before confirming removal. Recovery requires
an offline restore of the complete database; there is no per-company restore.
The server performs the aggregate cascade and its surviving removal audit in one
immediate transaction, so an audit-write failure restores all company rows.
Application audit history is intentionally not company-owned and is not removed.

## Restore

Restore is offline and replaces the complete database, not individual tables.
The restore command verifies SQLite integrity, foreign keys, and an optional
SHA-256 digest before changing the target. It migrates and verifies a staged copy,
creates a verified preservation backup of the current database, removes only the
target's stale WAL/SHM sidecars, atomically installs the staged database, verifies
it again, and records the operation in the restored audit log.

Verify without changing the target:

```bash
bun run db:restore --input ./backups/stam.sqlite --verify-only \
  --expected-sha256 "$RESTORE_SHA256"
```

For replacement, stop Stam first. The command cannot prove that another process
does not have the SQLite file open.

```bash
docker compose stop stam
docker compose run --rm --no-deps stam bun dist/server/restore.js \
  --input /data/backups/restore.sqlite \
  --expected-sha256 "$RESTORE_SHA256" \
  --replace \
  --operator "$USER" \
  --reason "INC-123"
docker compose up -d
docker compose ps
docker compose logs stam
```

Stage a backup before stopping with
`docker compose cp ./verified.sqlite stam:/data/backups/restore.sqlite`. Never
copy directly over the live database. Keep the generated `.pre-restore-*.sqlite`
preservation artifact until application-level verification is complete.

## Upgrade

1. Read release notes and review new migration SQL.
2. Create, verify, and export an off-host backup.
3. Record the current image digest and configuration.
4. Stop the service gracefully: `docker compose stop stam`.
5. Pull the intended image or rebuild from the intended source revision.
6. Start one replica: `docker compose up -d`.
7. Startup applies migrations before listening. Wait for healthy status and
   inspect `docker compose logs stam`.
8. Exercise sign-in, company listing, and a historical snapshot read before
   declaring the upgrade complete.

Do not roll back only the application image after a schema migration. Restore
the pre-upgrade database backup together with its compatible image when a true
rollback is required.

## Application UI

The browser application uses same-origin requests with session cookies. Company
selection is encoded in `/companies/:companyId/...` routes. Opening imports and
all ownership events call the non-writing preview endpoint before registration;
the backend remains authoritative for ownership, range, correction, and sequence
validation. Historical views always state their effective and registration-time
cutoffs. Frontend changes must follow `docs/design-system.md`.
