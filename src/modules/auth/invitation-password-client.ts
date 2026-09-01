import { InferPlugin } from "better-auth/client";
import type { InvitationPasswordPlugin } from "./invitation-password.ts";

export const invitationPasswordClient = () => InferPlugin<InvitationPasswordPlugin>();
