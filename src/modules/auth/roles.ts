export const GLOBAL_ROLES = {
  admin: "admin",
  user: "user",
  readonly: "readonly",
} as const;

export type GlobalRole = (typeof GLOBAL_ROLES)[keyof typeof GLOBAL_ROLES];

export const INVITABLE_ROLES = [GLOBAL_ROLES.user, GLOBAL_ROLES.readonly] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function userRoles(role: string | null | undefined): readonly string[] {
  return Object.freeze(
    (role ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isGlobalAdmin(roles: readonly string[]): boolean {
  return roles.includes(GLOBAL_ROLES.admin);
}

export function canWriteApplicationData(roles: readonly string[]): boolean {
  return roles.some((role) => role === GLOBAL_ROLES.admin || role === GLOBAL_ROLES.user);
}

export function isReadOnly(roles: readonly string[]): boolean {
  return roles.includes(GLOBAL_ROLES.readonly) && !canWriteApplicationData(roles);
}
