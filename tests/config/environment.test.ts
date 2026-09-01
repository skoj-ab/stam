import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvironment } from "../../src/config/environment.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("environment configuration", () => {
  test("generates and reuses a private production authentication secret", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-environment-"));
    directories.push(directory);
    const source = {
      NODE_ENV: "production",
      DATABASE_PATH: join(directory, "stam.sqlite"),
      PUBLIC_ORIGIN: "https://stam.example.com",
      WEBAUTHN_RP_ID: "stam.example.com",
    };

    const first = readEnvironment(source);
    const second = readEnvironment(source);
    const secretPath = join(directory, ".auth-secret");

    expect(first.AUTH_SECRET).toHaveLength(64);
    expect(second.AUTH_SECRET).toBe(first.AUTH_SECRET);
    expect(readFileSync(secretPath, "utf8")).toBe(first.AUTH_SECRET);
    expect(statSync(secretPath).mode & 0o777).toBe(0o600);
  });

  test("reads AUTH_SECRET from a Docker-compatible secret file", () => {
    const directory = mkdtempSync(join(tmpdir(), "stam-environment-"));
    directories.push(directory);
    const path = join(directory, "auth-secret");
    const secret = "file-auth-secret-with-at-least-32-characters";
    writeFileSync(path, `${secret}\n`, { mode: 0o600 });

    expect(readEnvironment({ AUTH_SECRET_FILE: path }).AUTH_SECRET).toBe(secret);
  });

  test("rejects ambiguous secret configuration", () => {
    expect(() =>
      readEnvironment({
        AUTH_SECRET: "environment-auth-secret-with-at-least-32-characters",
        AUTH_SECRET_FILE: "/run/secrets/stam_auth_secret",
      }),
    ).toThrow("Configure only one");
  });

  test("rejects unsafe production origins and placeholders", () => {
    const production = {
      NODE_ENV: "production",
      AUTH_SECRET: "production-auth-secret-with-at-least-32-characters",
      PUBLIC_ORIGIN: "https://stam.example.com",
      WEBAUTHN_RP_ID: "stam.example.com",
    };
    expect(readEnvironment(production).PUBLIC_ORIGIN).toBe(production.PUBLIC_ORIGIN);
    expect(() =>
      readEnvironment({ ...production, PUBLIC_ORIGIN: "https://stam.example.com/path" }),
    ).toThrow("without a path");
    expect(() =>
      readEnvironment({ ...production, WEBAUTHN_RP_ID: "https://stam.example.com" }),
    ).toThrow("lowercase domain");
    expect(() =>
      readEnvironment({
        ...production,
        AUTH_SECRET: "replace-with-at-least-32-random-characters",
      }),
    ).toThrow("AUTH_SECRET must be configured");
  });
});
