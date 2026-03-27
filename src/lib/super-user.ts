/**
 * Hardcoded super user — full system authority.
 * Never show as a role label in the UI; use only for server-side and discreet client checks.
 */
export function isSuperUser(user: { firstName: string; lastName: string; b2cId?: string }): boolean {
  const b2cId = user.b2cId?.trim().toUpperCase() ?? "";
  const configured = (process.env.SUPERUSER_B2C_IDS ?? "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  if (b2cId && configured.includes(b2cId)) return true;

  const fn = user.firstName.trim().toLowerCase();
  const ln = user.lastName.trim().toLowerCase();
  return fn === "nilo" && ln === "matunog";
}
