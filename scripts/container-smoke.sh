#!/bin/sh
set -eu

image="${1:-stam:ci}"
container="stam-smoke-$$"
volume="stam-smoke-data-$$"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker volume create "$volume" >/dev/null
docker run --detach --name "$container" \
  --env NODE_ENV=production \
  --env PUBLIC_ORIGIN=https://stam.example.com \
  --env WEBAUTHN_RP_ID=stam.example.com \
  --mount "type=volume,source=$volume,target=/data" \
  "$image" >/dev/null

wait_for_health() {
  attempt=0
  until docker exec "$container" bun -e '
    const response = await fetch("http://127.0.0.1:3100/api/health");
    process.exit(response.ok ? 0 : 1);
  ' >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      docker logs "$container"
      exit 1
    fi
    sleep 1
  done
}

secret_digest() {
  docker exec "$container" bun -e '
    import { createHash } from "node:crypto";
    import { readFileSync, statSync } from "node:fs";
    const path = "/data/.auth-secret";
    const secret = readFileSync(path, "utf8");
    if (secret.length !== 64 || (statSync(path).mode & 0o777) !== 0o600) process.exit(1);
    process.stdout.write(createHash("sha256").update(secret).digest("hex"));
  '
}

wait_for_health
initial_secret_digest="$(secret_digest)"
docker restart "$container" >/dev/null
wait_for_health
test "$(secret_digest)" = "$initial_secret_digest"

docker exec "$container" bun -e '
  const base = "http://127.0.0.1:3100";
  const status = await fetch(`${base}/api/setup/status`);
  if (!status.ok || !(await status.json()).required) process.exit(1);
  const setup = await fetch(`${base}/api/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://stam.example.com" },
    body: JSON.stringify({
      name: "Container Administrator",
      email: "container-admin@example.com",
      password: "smoke-test-administrator-password",
    }),
  });
  if (setup.status !== 201) process.exit(1);
  const login = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://stam.example.com" },
    body: JSON.stringify({
      email: "container-admin@example.com",
      password: "smoke-test-administrator-password",
    }),
  });
  process.exit(login.ok ? 0 : 1);
'

docker exec "$container" typst --version
docker exec "$container" pdftotext -v
docker stop --time 30 "$container" >/dev/null
