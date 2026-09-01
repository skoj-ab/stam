import { asc, desc, eq, or } from "drizzle-orm";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import { apikey, invitations, user } from "../../db/schema.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { ApplicationConflictError, NotFoundError } from "../errors.ts";
import { requireGlobalAdmin, userRoles } from "./authorization.ts";

export type InvitationStatus = "PENDING" | "CONSUMED" | "REVOKED" | "EXPIRED";

export function invitationStatus(
  invitation: Pick<typeof invitations.$inferSelect, "consumedAt" | "revokedAt" | "expiresAt">,
  asOf: Date,
): InvitationStatus {
  if (invitation.consumedAt) return "CONSUMED";
  if (invitation.revokedAt) return "REVOKED";
  return invitation.expiresAt.getTime() <= asOf.getTime() ? "EXPIRED" : "PENDING";
}

export function listAdminDirectory(
  database: DatabaseContext,
  actorUserId: string,
  asOf = new Date(),
) {
  requireGlobalAdmin(database, actorUserId);
  const users = database.db.select().from(user).orderBy(asc(user.name), asc(user.email)).all();
  const usersById = new Map(users.map((entry) => [entry.id, entry]));

  return Object.freeze({
    asOf,
    users: Object.freeze(
      users.map((entry) =>
        Object.freeze({
          id: entry.id,
          name: entry.name,
          email: entry.email,
          roles: userRoles(entry.role),
          accessStatus: entry.banned ? ("BANNED" as const) : ("ACTIVE" as const),
          createdAt: entry.createdAt,
          removable: entry.id !== actorUserId,
        }),
      ),
    ),
    invitations: Object.freeze(
      database.db
        .select()
        .from(invitations)
        .orderBy(desc(invitations.createdAt), asc(invitations.id))
        .all()
        .map((invitation) => {
          const target = usersById.get(invitation.userId);
          return Object.freeze({
            id: invitation.id,
            userId: invitation.userId,
            email: invitation.email,
            name: invitation.name,
            roles: userRoles(target?.role),
            status: invitationStatus(invitation, asOf),
            createdAt: invitation.createdAt,
            expiresAt: invitation.expiresAt,
            consumedAt: invitation.consumedAt,
            revokedAt: invitation.revokedAt,
            createdBy: invitation.createdBy,
            createdByName: usersById.get(invitation.createdBy)?.name ?? invitation.createdBy,
          });
        }),
    ),
  });
}

export function removeUser(
  database: DatabaseContext,
  targetUserId: string,
  actorUserId: string,
): void {
  const remove = () => {
    requireGlobalAdmin(database, actorUserId);
    if (targetUserId === actorUserId) {
      throw new ApplicationConflictError("Administrators cannot remove their own account");
    }
    const target = database.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, targetUserId))
      .get();
    if (!target) throw new NotFoundError(`User not found: ${targetUserId}`);

    database.db
      .delete(invitations)
      .where(or(eq(invitations.userId, targetUserId), eq(invitations.createdBy, targetUserId)))
      .run();
    database.db.delete(apikey).where(eq(apikey.referenceId, targetUserId)).run();
    database.db.delete(user).where(eq(user.id, targetUserId)).run();
    recordAuditEvent(database, {
      type: "AUTH_ADMINISTRATION",
      outcome: "SUCCEEDED",
      actorKind: "USER",
      actorUserId,
      targetKind: "USER",
      targetId: targetUserId,
      payload: { action: "REMOVE_USER" },
    });
  };

  if (database.sqlite.inTransaction) {
    remove();
    return;
  }
  withImmediateTransaction(database.sqlite, remove);
}
