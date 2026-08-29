# Security policy

## Supported versions

Stam is currently pre-1.0. Security fixes are made on the latest `main` branch
and included in the next release. Older revisions are not supported.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a
public issue for a suspected vulnerability or include personal data, database
contents, credentials, or exploit details in public discussions.

Maintainers must enable private vulnerability reporting as part of making the
repository public and verify that the reporting link is available.

Include the affected revision, impact, reproduction steps, and any suggested
mitigation. You should receive an acknowledgement within seven days.

## Accepted development-tool advisory

`drizzle-kit@0.31.10` depends transitively on `esbuild@0.18.20`, which is listed
under GHSA-67mh-4wv8-2f99. The advisory concerns esbuild's development-server
feature accepting cross-origin requests. Stam uses this dependency only through
the local migration-generation CLI; it is absent from production bundles and
the runtime container, and no esbuild server is started. The stable migration
tool is retained because its current beta release is incompatible with the
stable `drizzle-orm` version. Reassess this exception when either package has a
compatible stable update.

## Deployment responsibility

Stam stores personal identifiers and legally significant ownership records.
Operators are responsible for TLS termination, access control, filesystem and
backup protection, secret management, updates, monitoring, and applicable data
protection obligations. The application is not a substitute for legal advice.
