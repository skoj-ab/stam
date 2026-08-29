import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { DatabaseContext } from "../../db/database.ts";
import { user } from "../../db/schema.ts";

export function userRoles(role: string | null | undefined): readonly string[] {
  return Object.freeze(
    (role ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function requireGlobalAdmin(database: DatabaseContext, userId: string): void {
  const actor = database.db.select({ role: user.role }).from(user).where(eq(user.id, userId)).get();
  if (!userRoles(actor?.role).includes("admin")) {
    throw new APIError("FORBIDDEN", {
      message: "Only an administrator can perform this operation",
    });
  }
}
