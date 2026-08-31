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
bun run dev
```

The development SPA is served at `http://localhost:5174` and proxies
`/api` to the Hono server at `http://localhost:3100`. `bun run dev:server` alone
starts only the API. Migrations also run automatically before the HTTP listener
starts. Open `/setup` to create the first administrator. Setup is available only
while the user table is empty; the first person to complete it becomes the
global administrator.

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
export STAM_VERSION=edge # Prefer an exact release version in production.
docker compose pull
docker compose up -d
docker compose ps
```

Open `https://stam.example.com/setup` immediately and create the first
administrator. The setup page is intentionally open on an empty database: the
first visitor can claim the installation. It disappears after the administrator
is created.

To build the image from the current checkout instead:

```bash
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Compose runs one non-root application service, uses the `stam-data` named volume,
binds HTTP only to host loopback, checks `/api/health`, and allows 30 seconds
for graceful shutdown. Production must terminate TLS at a reverse proxy and
forward the public origin unchanged.

For automatic HTTPS after DNS points to the host and inbound ports 80 and 443
are open, add the Caddy configuration:

```bash
docker compose -f compose.yaml -f compose.caddy.yaml up -d
```

Docker Swarm stacks for an existing reverse proxy and for bundled Caddy are
provided as `stack.yaml` and `stack.caddy.yaml`. Both enforce one Stam replica
on a labeled data node and use a Docker secret for `AUTH_SECRET`; see
[Operations](docs/operations.md#docker-swarm).

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
