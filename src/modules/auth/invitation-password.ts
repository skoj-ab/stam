import {
  BASE_ERROR_CODES,
  type BetterAuthPlugin,
  createLocalAccountIssuer,
  generateId,
} from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getIP } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type DatabaseContext, withImmediateTransaction } from "../../db/database.ts";
import { account, session, user } from "../../db/schema.ts";
import { consumeInvitation, resolveInvitation } from "./invitations.ts";

const credentialIssuer = createLocalAccountIssuer("credential");

const acceptInvitationPasswordBodySchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string(),
  })
  .strict();

const requireInvitationOrigin = createAuthMiddleware(async (context) => {
  const origin = context.headers?.get("origin");
  if (!origin) {
    throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.MISSING_OR_NULL_ORIGIN);
  }
  if (!context.context.isTrustedOrigin(origin, { allowRelativePaths: false })) {
    throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.INVALID_ORIGIN);
  }
});

function credentialAccountExists(database: DatabaseContext, userId: string): boolean {
  return Boolean(
    database.db
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          eq(account.providerId, "credential"),
          eq(account.issuer, credentialIssuer),
          eq(account.accountId, userId),
        ),
      )
      .get(),
  );
}

function throwCredentialAccountExists(): never {
  throw APIError.from("CONFLICT", {
    code: "CREDENTIAL_ACCOUNT_EXISTS",
    message: "The invited user already has a password credential",
  });
}

export function invitationPassword(database: DatabaseContext) {
  return {
    id: "stam-invitation-password",
    endpoints: {
      acceptInvitationPassword: createAuthEndpoint(
        "/invitation/accept-password",
        {
          method: "POST",
          requireHeaders: true,
          body: acceptInvitationPasswordBodySchema,
          use: [requireInvitationOrigin],
          metadata: { noStore: true },
        },
        async (context) => {
          const { token, newPassword } = context.body;
          const invitation = resolveInvitation(database, token);
          if (credentialAccountExists(database, invitation.userId)) {
            throwCredentialAccountExists();
          }

          const { minPasswordLength, maxPasswordLength } = context.context.password.config;
          if (newPassword.length < minPasswordLength) {
            throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.PASSWORD_TOO_SHORT);
          }
          if (newPassword.length > maxPasswordLength) {
            throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.PASSWORD_TOO_LONG);
          }

          const passwordHash = await context.context.password.hash(newPassword);
          const createdAt = new Date();
          const accountId = context.context.generateId({ model: "account" }) || generateId();
          const sessionId = context.context.generateId({ model: "session" }) || generateId();
          const sessionToken = generateId(32);
          const expiresAt = new Date(
            createdAt.getTime() + context.context.sessionConfig.expiresIn * 1000,
          );
          const ipAddress = getIP(context.headers, context.context.options) ?? "";
          const userAgent = context.headers.get("user-agent") ?? "";

          const persist = () => {
            const currentInvitation = resolveInvitation(database, token, createdAt);
            if (credentialAccountExists(database, currentInvitation.userId)) {
              throwCredentialAccountExists();
            }

            const authUser = database.db
              .select()
              .from(user)
              .where(eq(user.id, currentInvitation.userId))
              .get();
            if (!authUser) {
              throw APIError.from("BAD_REQUEST", {
                code: "INVALID_INVITATION",
                message: "Invitation is invalid",
              });
            }

            consumeInvitation(database, token, currentInvitation.userId, createdAt);
            database.db
              .insert(account)
              .values({
                id: accountId,
                issuer: credentialIssuer,
                accountId: currentInvitation.userId,
                providerId: "credential",
                userId: currentInvitation.userId,
                password: passwordHash,
                createdAt,
                updatedAt: createdAt,
              })
              .run();

            const createdSession: typeof session.$inferSelect = {
              id: sessionId,
              token: sessionToken,
              userId: currentInvitation.userId,
              expiresAt,
              createdAt,
              updatedAt: createdAt,
              ipAddress,
              userAgent,
              impersonatedBy: null,
            };
            database.db.insert(session).values(createdSession).run();
            return { session: createdSession, user: authUser };
          };

          const created = database.sqlite.inTransaction
            ? persist()
            : withImmediateTransaction(database.sqlite, persist);
          await setSessionCookie(context, created);

          return context.json({
            user: {
              id: created.user.id,
              email: created.user.email,
              name: created.user.name,
            },
            session: {
              id: created.session.id,
              expiresAt: created.session.expiresAt.toISOString(),
            },
          });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path) => path === "/invitation/accept-password",
        window: 60,
        max: 5,
      },
    ],
  } satisfies BetterAuthPlugin;
}

export type InvitationPasswordPlugin = ReturnType<typeof invitationPassword>;
