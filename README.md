# Stam

Stam is a small, self-hosted share-register application for multiple private
limited companies. It combines an immutable ownership-event engine, SQLite
persistence, local password/passkey authentication, an HTTP API, and a Swedish
application interface in one deployable service.

The application supports company and catalog setup, reviewed opening-state
imports (including direct Fortnox PDF/HTML uploads), ownership events, immutable
event history, current or historical share-register views, audited HTML/PDF exports,
an append-only application audit log, and verified backup/restore. The design
system's living reference is served at `/design`.

## Requirements

- Bun 1.4.0
- Typst 0.15.1 and Liberation fonts for local PDF export development
- Poppler `pdftotext` for local Fortnox PDF import development
- A local filesystem for SQLite
- Docker with Compose v2 for the container workflow

## Local development

```bash
bun install --frozen-lockfile
cp .env.example .env
bun run db:migrate
STAM_ADMIN_EMAIL=admin@example.com \
STAM_ADMIN_NAME=Administrator \
STAM_ADMIN_PASSWORD='replace-with-a-strong-password' \
bun run auth:bootstrap
bun run dev
```

The development SPA is served at `http://localhost:5174` and proxies
`/api` to the Hono server at `http://localhost:3100`. `bun run dev:server` alone
starts only the API. Migrations also run automatically before the HTTP listener
starts. The bootstrap command applies migrations and refuses to run after any
user exists.

Sign in at `/login`. The selected company is part of the URL, so register,
history, event, shareholder, and share-class views can be bookmarked directly.
The **Lägg till bolag** page offers manual creation, Fortnox import, and OCF
import. OCF export is available from the current share register, while capital
changes, splits, and complete renumbering are available under **Händelser**.
The account menu exposes user-owned API keys, and administrators can manage
invitations, inspect invitation status, and remove users from **Användare och
inbjudningar**.

Useful checks:

```bash
bun test
bun run typecheck
bun run lint
bun run audit
bun run build
```

`bun run lint` runs Biome and then `scripts/check-design-system.ts`, which keeps
frontend code inside the design system. See `docs/design-system.md` for the
visual language and the rules that apply when writing frontend code.

The production build contains `dist/web`, `dist/server/index.js`, compiled
`bootstrap-admin.js`, `backup.js`, and `restore.js` command entrypoints,
`dist/server/drizzle`, the Typst share-register template, and generated
JavaScript dependency notices under `dist/licenses`. The container includes the
pinned Typst compiler, fonts required for PDF exports, Poppler utilities
required for Fortnox PDF imports, and the applicable third-party license and
notice files.

## Docker Compose

```bash
export AUTH_SECRET="$(openssl rand -base64 48)"
export PUBLIC_ORIGIN=https://stam.example.com
export WEBAUTHN_RP_ID=stam.example.com
docker compose build
docker compose up -d
docker compose ps
```

Create the first administrator before exposing a new installation:

```bash
docker compose stop stam
docker compose run --rm \
  -e STAM_ADMIN_EMAIL=admin@example.com \
  -e STAM_ADMIN_NAME=Administrator \
  -e STAM_ADMIN_PASSWORD='replace-with-a-strong-password' \
  stam bun dist/server/bootstrap-admin.js
docker compose up -d
```

Compose runs one non-root application service, uses the `stam-data` named volume,
binds HTTP only to host loopback, checks `/api/health`, and allows 30 seconds
for graceful shutdown. Production must terminate TLS at a reverse proxy and
forward the public origin unchanged.

## Documentation

- [Operations](docs/operations.md): configuration, deployment, backup/restore,
  upgrades, and SQLite constraints.
- [API](docs/api.md): implemented endpoint and authentication contracts.
- [Implementation plan](docs/implementation-plan.md): product and architecture
  context; it is a plan, so the API documentation is authoritative for current
  behavior.
- [Contributing](CONTRIBUTING.md): development workflow and verification rules.
- [Security](SECURITY.md): supported versions and private vulnerability reporting.

Every authenticated user can access every company. There are no tenants,
company memberships, or per-company roles. Only global administrators can
list or create invitations or permanently remove a company. User-owned API keys
provide the same access as their owning user; `GET /api/agent` documents the
operations available to the current credential. The API also supports the
documented Swedish-stock subset of OCF v1.2.0 import and export.

## AI-assisted development

Stam was created and is developed with the active assistance of
software-development agents. Agents contribute to implementation, tests,
documentation, code review, and repository maintenance under maintainer
direction.

[CodeScene](https://codescene.com/) Code Health and the CodeScene MCP server are
used as maintainability safeguards during development. Changes are also
validated through automated tests, type checking, linting, and production
builds.

Agent assistance and automated analysis do not replace maintainer
responsibility. The project maintainer remains accountable for design
decisions, accepted changes, security, and releases.

## Fortnox

Fortnox is a trademark of Fortnox AB. Stam is an independent project and is not
affiliated with or endorsed by Fortnox AB.

## License

Copyright (C) 2026 Skoj AB. Stam is free software licensed under the
[GNU Affero General Public License, version 3 or later](LICENSE). See
[Third-party notices](THIRD_PARTY_NOTICES.md) for separately licensed material.
