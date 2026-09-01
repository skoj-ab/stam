import { adminAc, userAc } from "better-auth/plugins/admin/access";

export const authRoles = {
  admin: adminAc,
  user: userAc,
  readonly: userAc,
} as const;
