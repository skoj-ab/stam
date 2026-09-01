import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_PATH: z.string().min(1).default("./data/stam.sqlite"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:5174"),
  AUTH_SECRET: z.string().min(32).default("development-only-secret-change-me-now"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
});

const documentedAuthSecretPlaceholder = "replace-with-at-least-32-random-characters";
const generatedAuthSecretFilename = ".auth-secret";
const rpIdPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type Environment = z.infer<typeof environmentSchema>;

function readOrCreateGeneratedAuthSecret(databasePath: string): string {
  const secretPath = join(dirname(databasePath), generatedAuthSecretFilename);
  mkdirSync(dirname(secretPath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(secretPath, randomBytes(48).toString("base64"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(secretPath, "utf8");
}

function readConfiguredAuthSecret(path: string | undefined): string {
  if (!path) throw new Error("AUTH_SECRET_FILE must not be empty");
  return readFileSync(path, "utf8").replace(/\r?\n$/, "");
}

function resolveAuthSecret(source: Record<string, string | undefined>) {
  const valueConfigured = source.AUTH_SECRET !== undefined;
  const fileConfigured = source.AUTH_SECRET_FILE !== undefined;
  if (valueConfigured && fileConfigured) {
    throw new Error("Configure only one of AUTH_SECRET and AUTH_SECRET_FILE");
  }
  if (!fileConfigured) {
    if (valueConfigured || source.NODE_ENV !== "production") return source;
    return {
      ...source,
      AUTH_SECRET: readOrCreateGeneratedAuthSecret(source.DATABASE_PATH ?? "./data/stam.sqlite"),
    };
  }

  return {
    ...source,
    AUTH_SECRET: readConfiguredAuthSecret(source.AUTH_SECRET_FILE),
  };
}

function parseEnvironment(source: Record<string, string | undefined>): Environment {
  const result = environmentSchema.safeParse(resolveAuthSecret(source));
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}

function validateProductionSecret(secret: string): void {
  if (
    secret === "development-only-secret-change-me-now" ||
    secret === documentedAuthSecretPlaceholder
  ) {
    throw new Error("AUTH_SECRET must be configured in production");
  }
}

function validateProductionOrigin(value: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.origin !== value) {
    throw new Error("PUBLIC_ORIGIN must be an HTTPS origin without a path in production");
  }
  return origin;
}

function validateProductionRpId(rpId: string, originHostname: string): void {
  const rpMatchesOrigin = originHostname === rpId || originHostname.endsWith(`.${rpId}`);
  if (!rpIdPattern.test(rpId) || !rpMatchesOrigin) {
    throw new Error(
      "WEBAUTHN_RP_ID must be a lowercase domain matching PUBLIC_ORIGIN without a scheme, port, or path",
    );
  }
}

function validateProductionEnvironment(environment: Environment): void {
  if (environment.NODE_ENV !== "production") return;
  validateProductionSecret(environment.AUTH_SECRET);
  const publicOrigin = validateProductionOrigin(environment.PUBLIC_ORIGIN);
  validateProductionRpId(environment.WEBAUTHN_RP_ID, publicOrigin.hostname);
}

export function readEnvironment(source: Record<string, string | undefined> = Bun.env): Environment {
  const environment = parseEnvironment(source);
  validateProductionEnvironment(environment);
  return environment;
}
