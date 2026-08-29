import { count } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseContext } from "../../db/database.ts";
import { user } from "../../db/schema.ts";
import { recordAuditEvent } from "../audit/index.ts";
import type { StamAuth } from "./auth.ts";
import { normalizeInvitationEmail } from "./invitations.ts";

const bootstrapAdminInputSchema = z
  .object({
    email: z.string().transform(normalizeInvitationEmail),
    name: z.string().trim().min(1),
    password: z.string().min(8).max(128),
  })
  .strict();

export type BootstrapAdminInput = z.input<typeof bootstrapAdminInputSchema>;

export async function bootstrapFirstAdmin(
  auth: StamAuth,
  database: DatabaseContext,
  input: BootstrapAdminInput,
) {
  const values = bootstrapAdminInputSchema.parse(input);
  const existingUsers = database.db.select({ count: count() }).from(user).get()?.count ?? 0;
  if (existingUsers !== 0) {
    throw new Error("Bootstrap is only available before the first user is created");
  }

  const result = await auth.api.createUser({
    body: {
      email: values.email,
      name: values.name,
      password: values.password,
      role: "admin",
    },
  });
  recordAuditEvent(database, {
    type: "AUTH_ADMINISTRATION",
    outcome: "SUCCEEDED",
    actorKind: "SYSTEM",
    targetKind: "USER",
    targetId: result.user.id,
    payload: { action: "BOOTSTRAP" },
  });
  return result;
}
