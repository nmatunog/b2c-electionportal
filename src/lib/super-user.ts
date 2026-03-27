/**
 * Hardcoded super user — full system authority.
 * Never show as a role label in the UI; use only for server-side and discreet client checks.
 */
export function isSuperUser(user: { firstName: string; lastName: string }): boolean {
  const fn = user.firstName.trim().toLowerCase();
  const ln = user.lastName.trim().toLowerCase();
  return fn === "nilo" && ln === "matunog";
}
