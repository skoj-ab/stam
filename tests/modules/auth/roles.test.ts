import { describe, expect, test } from "bun:test";
import {
  canWriteApplicationData,
  isGlobalAdmin,
  isReadOnly,
  userRoles,
} from "../../../src/modules/auth/roles.ts";

describe("global authorization roles", () => {
  test("parses comma-separated roles consistently", () => {
    expect(userRoles(" user, admin, ,readonly ")).toEqual(["user", "admin", "readonly"]);
    expect(userRoles(null)).toEqual([]);
    expect(Object.isFrozen(userRoles("user"))).toBe(true);
  });

  test("derives administrator, write, and read-only capabilities", () => {
    expect(isGlobalAdmin(["admin"])).toBe(true);
    expect(canWriteApplicationData(["admin"])).toBe(true);
    expect(canWriteApplicationData(["user"])).toBe(true);
    expect(canWriteApplicationData(["readonly"])).toBe(false);
    expect(isReadOnly(["readonly"])).toBe(true);
  });

  test("fails closed for unknown roles and combines known capabilities", () => {
    expect(canWriteApplicationData([])).toBe(false);
    expect(canWriteApplicationData(["unknown"])).toBe(false);
    expect(isReadOnly(["unknown"])).toBe(false);
    expect(canWriteApplicationData(["readonly", "user"])).toBe(true);
    expect(isReadOnly(["readonly", "user"])).toBe(false);
  });
});
