import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { DatabaseContext } from "../../db/database.ts";
import { user } from "../../db/schema.ts";
import { isGlobalAdmin, userRoles } from "./roles.ts";

export { userRoles } from "./roles.ts";

export function requireGlobalAdmin(database: DatabaseContext, userId: string): void {
  const actor = database.db.select({ role: user.role }).from(user).where(eq(user.id, userId)).get();
  if (!isGlobalAdmin(userRoles(actor?.role))) {
    throw new APIError("FORBIDDEN", {
      message: "Only an administrator can perform this operation",
    });
  }
}
