# syntax=docker/dockerfile:1

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS typst
ARG TARGETARCH
ARG TYPST_VERSION=0.15.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && case "$TARGETARCH" in \
         amd64) TYPST_TARGET="x86_64-unknown-linux-musl"; TYPST_SHA256="a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c" ;; \
         arm64) TYPST_TARGET="aarch64-unknown-linux-musl"; TYPST_SHA256="5aa8d74a3d906e60ea12a66ac2f37f8eef1b14cbad7182a745e393a10c23dcee" ;; \
         *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && curl --fail --location "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_TARGET}.tar.xz" --output /tmp/typst.tar.xz \
    && echo "${TYPST_SHA256}  /tmp/typst.tar.xz" | sha256sum --check - \
    && mkdir /tmp/typst \
    && tar -xJf /tmp/typst.tar.xz --strip-components=1 -C /tmp/typst \
    && install -m 0755 /tmp/typst/typst /usr/local/bin/typst \
    && install -D -m 0644 /tmp/typst/LICENSE /usr/share/licenses/typst/LICENSE \
    && install -D -m 0644 /tmp/typst/NOTICE /usr/share/licenses/typst/NOTICE

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Stam" \
      org.opencontainers.image.description="A self-hosted share register for Swedish private limited companies" \
      org.opencontainers.image.url="https://github.com/skoj-ab/stam" \
      org.opencontainers.image.documentation="https://github.com/skoj-ab/stam/blob/main/docs/operations.md" \
      org.opencontainers.image.source="https://github.com/skoj-ab/stam" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    PORT=3100 \
    DATABASE_PATH=/data/stam.sqlite

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends fonts-liberation poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data \
    && chown bun:bun /data
COPY --from=typst /usr/local/bin/typst /usr/local/bin/typst
COPY --from=typst /usr/share/licenses/typst /usr/share/licenses/typst
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build /app/LICENSE /usr/share/licenses/stam/LICENSE
COPY --from=build /app/THIRD_PARTY_NOTICES.md /usr/share/licenses/stam/THIRD_PARTY_NOTICES.md
COPY --from=build /app/licenses /usr/share/licenses/stam/third-party
COPY --from=build /app/dist/licenses/JS-DEPENDENCIES.md /usr/share/licenses/stam/third-party/JS-DEPENDENCIES.md

RUN test -s /usr/share/licenses/typst/LICENSE \
    && test -s /usr/share/licenses/typst/NOTICE \
    && test -s /usr/share/licenses/stam/third-party/Bun-1.4.0-LICENSE.md \
    && test -s /usr/share/licenses/stam/third-party/JS-DEPENDENCIES.md \
    && test -s /usr/share/doc/fonts-liberation/copyright \
    && test -s /usr/share/doc/poppler-utils/copyright

USER bun
EXPOSE 3100
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:3100/api/health'); process.exit(response.ok ? 0 : 1)"]
CMD ["bun", "dist/server/index.js"]
