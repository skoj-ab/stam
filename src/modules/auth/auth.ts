import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import type { Environment } from "../../config/environment.ts";
import type { DatabaseContext } from "../../db/database.ts";
import * as schema from "../../db/schema.ts";
import { invitationPassword } from "./invitation-password.ts";
import { consumeInvitation, resolveInvitation } from "./invitations.ts";

export function finishPasskeyRegistration(
  database: DatabaseContext,
  context: string | null | undefined,
  userId: string,
) {
  if (context) consumeInvitation(database, context, userId);
  return { userId };
}

export function createAuth(database: DatabaseContext, environment: Environment) {
  return betterAuth({
    appName: "Stam",
    baseURL: environment.PUBLIC_ORIGIN,
    trustedOrigins: [environment.PUBLIC_ORIGIN],
    secret: environment.AUTH_SECRET,
    database: drizzleAdapter(database.db, {
      provider: "sqlite",
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    rateLimit: {
      enabled: environment.NODE_ENV !== "test",
      storage: "memory",
    },
    plugins: [
      invitationPassword(database),
      admin(),
      apiKey({
        enableSessionForAPIKeys: true,
        defaultPrefix: "stam_",
        requireName: true,
        rateLimit: {
          enabled: true,
          timeWindow: 60_000,
          maxRequests: 600,
        },
      }),
      passkey({
        rpID: environment.WEBAUTHN_RP_ID,
        origin: environment.PUBLIC_ORIGIN,
        registration: {
          requireSession: false,
          resolveUser: ({ context }) => {
            const invitation = resolveInvitation(database, context);
            return {
              id: invitation.userId,
              name: invitation.email,
              displayName: invitation.name,
            };
          },
          afterVerification: ({ context, user }) => {
            return finishPasskeyRegistration(database, context, user.id);
          },
        },
      }),
    ],
  });
}

export type StamAuth = ReturnType<typeof createAuth>;
