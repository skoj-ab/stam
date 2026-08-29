import { createHash, randomBytes, randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import { invitations, user } from "../../db/schema.ts";
import { recordAuditEvent } from "../audit/index.ts";
import { requireGlobalAdmin } from "./authorization.ts";

export const DEFAULT_INVITATION_TTL_MS = 15 * 60 * 1000;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
const nonemptyStringSchema = z.string().trim().min(1);

const createInvitationInputSchema = z
  .object({
    userId: nonemptyStringSchema,
    email: emailSchema,
    name: nonemptyStringSchema,
    createdBy: nonemptyStringSchema,
    expiresAt: z.date().optional(),
  })
  .strict();

export const adminInvitationInputSchema = z
  .object({
    email: emailSchema,
    name: nonemptyStringSchema,
    expiresAt: z.iso.datetime({ offset: false }).optional(),
  })
  .strict();

export type CreateInvitationInput = z.input<typeof createInvitationInputSchema>;
export type AdminInvitationInput = z.input<typeof adminInvitationInputSchema>;

export type Invitation = Readonly<{
  id: string;
  userId: string;
  email: string;
  name: string;
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
  consumedAt: Date | null;
}>;

export type CreatedInvitation = Readonly<{
  invitation: Invitation;
  token: string;
}>;

export const INVITATION_ERROR_CODES = {
  invalid: "INVALID_INVITATION",
  expired: "EXPIRED_INVITATION",
  consumed: "CONSUMED_INVITATION",
  userMismatch: "INVITATION_USER_MISMATCH",
} as const;

function invitationError(
  code: (typeof INVITATION_ERROR_CODES)[keyof typeof INVITATION_ERROR_CODES],
  message: string,
): APIError {
  return APIError.from("BAD_REQUEST", { code, message });
}

export function normalizeInvitationEmail(email: string): string {
  return emailSchema.parse(email);
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function toInvitation(row: typeof invitations.$inferSelect): Invitation {
  return Object.freeze({
    id: row.id,
    userId: row.userId,
    email: row.email,
    name: row.name,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    consumedAt: row.consumedAt,
  });
}

function requireValidRow(
  database: DatabaseContext,
  token: string | null | undefined,
  now: Date,
): typeof invitations.$inferSelect {
  if (!token) {
    throw invitationError(INVITATION_ERROR_CODES.invalid, "Invitation token is required");
  }

  const result = database.db
    .select({ invitation: invitations, authUser: user })
    .from(invitations)
    .innerJoin(user, eq(invitations.userId, user.id))
    .where(eq(invitations.tokenHash, hashInvitationToken(token)))
    .get();

  if (!result || result.authUser.email !== result.invitation.email) {
    throw invitationError(INVITATION_ERROR_CODES.invalid, "Invitation is invalid");
  }
  if (result.invitation.consumedAt) {
    throw invitationError(INVITATION_ERROR_CODES.consumed, "Invitation has already been used");
  }
  if (result.invitation.expiresAt.getTime() <= now.getTime()) {
    throw invitationError(INVITATION_ERROR_CODES.expired, "Invitation has expired");
  }
  return result.invitation;
}

function getExpiry(expiresAt: Date | undefined, createdAt: Date): Date {
  const resolved = expiresAt ?? new Date(createdAt.getTime() + DEFAULT_INVITATION_TTL_MS);
  if (resolved.getTime() <= createdAt.getTime()) {
    throw APIError.from("BAD_REQUEST", {
      code: "INVALID_INVITATION_EXPIRY",
      message: "Invitation expiry must be in the future",
    });
  }
  return resolved;
}

function requireMatchingUser(
  database: DatabaseContext,
  userId: string,
  email: string,
  name: string,
): void {
  const target = database.db.select().from(user).where(eq(user.id, userId)).get();
  if (!target) throwInvitationIdentityMismatch();
  if (target.email !== email) throwInvitationIdentityMismatch();
  if (target.name !== name) throwInvitationIdentityMismatch();
}

function throwInvitationIdentityMismatch(): never {
  throw invitationError(
    INVITATION_ERROR_CODES.userMismatch,
    "Invitation identity does not match the user",
  );
}

export function createInvitation(
  database: DatabaseContext,
  input: CreateInvitationInput,
): CreatedInvitation {
  const values = createInvitationInputSchema.parse(input);
  const createdAt = new Date();
  const expiresAt = getExpiry(values.expiresAt, createdAt);
  requireMatchingUser(database, values.userId, values.email, values.name);
  requireGlobalAdmin(database, values.createdBy);

  const token = randomBytes(32).toString("base64url");
  const row: typeof invitations.$inferSelect = {
    id: randomUUID(),
    tokenHash: hashInvitationToken(token),
    userId: values.userId,
    email: values.email,
    name: values.name,
    expiresAt,
    createdAt,
    createdBy: values.createdBy,
    consumedAt: null,
  };
  const persist = () => {
    database.db.insert(invitations).values(row).run();
    recordAuditEvent(database, {
      type: "INVITATION_CREATED",
      outcome: "SUCCEEDED",
      actorKind: "USER",
      actorUserId: values.createdBy,
      targetKind: "INVITATION",
      targetId: row.id,
      payload: { targetUserId: row.userId, expiresAt: row.expiresAt.toISOString() },
    });
    return Object.freeze({ invitation: toInvitation(row), token });
  };

  return database.sqlite.inTransaction
    ? persist()
    : withImmediateTransaction(database.sqlite, persist);
}

export async function createAdminInvitation(
  auth: import("./auth.ts").StamAuth,
  database: DatabaseContext,
  input: AdminInvitationInput,
  createdBy: string,
): Promise<CreatedInvitation> {
  const values = adminInvitationInputSchema.parse(input);
  requireGlobalAdmin(database, createdBy);

  const existing = database.db.select().from(user).where(eq(user.email, values.email)).get();
  if (existing && existing.name !== values.name) {
    throw APIError.from("CONFLICT", {
      code: "INVITATION_IDENTITY_MISMATCH",
      message: "An existing user with this email has a different name",
    });
  }

  const target =
    existing ??
    (
      await auth.api.createUser({
        body: { email: values.email, name: values.name },
      })
    ).user;

  return createInvitation(database, {
    userId: target.id,
    email: values.email,
    name: values.name,
    createdBy,
    expiresAt: values.expiresAt ? new Date(values.expiresAt) : undefined,
  });
}

export function resolveInvitation(
  database: DatabaseContext,
  token: string | null | undefined,
  now = new Date(),
): Invitation {
  return toInvitation(requireValidRow(database, token, now));
}

export function consumeInvitation(
  database: DatabaseContext,
  token: string | null | undefined,
  userId: string,
  now = new Date(),
): Invitation {
  const consume = () => {
    const invitation = requireValidRow(database, token, now);
    if (invitation.userId !== userId) {
      throw invitationError(
        INVITATION_ERROR_CODES.userMismatch,
        "Invitation does not belong to this user",
      );
    }

    const consumed = database.db
      .update(invitations)
      .set({ consumedAt: now })
      .where(
        and(
          eq(invitations.id, invitation.id),
          eq(invitations.userId, userId),
          eq(invitations.tokenHash, hashInvitationToken(token ?? "")),
          isNull(invitations.consumedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .returning({ id: invitations.id })
      .get();
    if (!consumed) {
      throw invitationError(INVITATION_ERROR_CODES.consumed, "Invitation has already been used");
    }
    recordAuditEvent(database, {
      type: "INVITATION_CONSUMED",
      outcome: "SUCCEEDED",
      actorKind: "USER",
      actorUserId: userId,
      targetKind: "INVITATION",
      targetId: invitation.id,
      payload: { targetUserId: userId },
    });
    return Object.freeze({ ...toInvitation(invitation), consumedAt: now });
  };

  if (database.sqlite.inTransaction) {
    return consume();
  }
  return withImmediateTransaction(database.sqlite, consume);
}
