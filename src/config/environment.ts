import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3100),
  DATABASE_PATH: z.string().min(1).default("./data/stam.sqlite"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:5174"),
  AUTH_SECRET: z.string().min(32).default("development-only-secret-change-me-now"),
  WEBAUTHN_RP_ID: z.string().min(1).default("localhost"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: Record<string, string | undefined> = Bun.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }

  if (result.data.NODE_ENV === "production") {
    if (result.data.AUTH_SECRET === "development-only-secret-change-me-now") {
      throw new Error("AUTH_SECRET must be configured in production");
    }
    if (!result.data.PUBLIC_ORIGIN.startsWith("https://")) {
      throw new Error("PUBLIC_ORIGIN must use HTTPS in production");
    }
  }

  return result.data;
}
