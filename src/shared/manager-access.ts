import type { MembershipRoleValue } from "@/types/desktop-api";

export function isAdminRole(role: MembershipRoleValue | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canAccessManagerFloor(
  role: MembershipRoleValue | null | undefined,
): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}
