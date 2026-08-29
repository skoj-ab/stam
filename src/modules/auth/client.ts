import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";

export function getAuthClientBaseURL(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

export const authClient = createAuthClient({
  baseURL: getAuthClientBaseURL(),
  plugins: [passkeyClient(), adminClient(), apiKeyClient()],
});
