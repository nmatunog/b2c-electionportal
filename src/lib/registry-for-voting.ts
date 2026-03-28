import type { RegistryMember } from "@/components/portal/types";

/**
 * Full roster for nomination/voting UIs: server `User` rows plus the current session member
 * when they are not yet present (e.g. right after self-register before refresh completes, or
 * transient load failure). Dedupes by B2C ID and by TIN when both sides have digits.
 */
export function mergeSessionMemberIntoRegistry(
  masterRegistry: RegistryMember[],
  sessionMember: (RegistryMember & { b2cId?: string }) | null,
): RegistryMember[] {
  if (!sessionMember) return masterRegistry;
  const b2c = typeof sessionMember.b2cId === "string" ? sessionMember.b2cId.trim() : "";
  if (!b2c) return masterRegistry;

  const tinDigits =
    typeof sessionMember.tinNo === "string" ? sessionMember.tinNo.replace(/\D/g, "") : "";

  const matchesExisting = masterRegistry.some((m) => {
    if (m.b2cId && m.b2cId === b2c) return true;
    if (tinDigits.length >= 9 && m.tinNo.replace(/\D/g, "") === tinDigits) return true;
    return false;
  });
  if (matchesExisting) return masterRegistry;

  const row: RegistryMember = {
    lastName: sessionMember.lastName,
    firstName: sessionMember.firstName,
    city: sessionMember.city ?? "",
    timestamp: sessionMember.timestamp ?? "",
    role: sessionMember.role ?? "Member",
    tinNo: tinDigits || sessionMember.tinNo || "",
    dob: sessionMember.dob ?? "",
    b2cId: b2c,
  };

  const merged = [...masterRegistry, row];
  merged.sort((a, b) => a.lastName.localeCompare(b.lastName));
  return merged;
}
