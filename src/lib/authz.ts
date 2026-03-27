import { prisma } from "@/lib/prisma";

import { isSuperUser } from "./super-user";

export { isSuperUser } from "./super-user";

export type UserForAuthz = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
};

export async function userHasPortalAdminGrant(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, role: true },
  });
  if (!user) return false;
  if (isSuperUser(user)) return true;
  if (user.role === "Admin") return true;

  const withAssignment = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      officerAssignments: {
        where: { active: true },
        select: { position: { select: { grantsPortalAdmin: true } } },
      },
    },
  });
  return (
    withAssignment?.officerAssignments.some((a) => a.position.grantsPortalAdmin) ?? false
  );
}

export async function userHasElectionCommitteeAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, role: true },
  });
  if (!user) return false;
  if (isSuperUser(user)) return true;
  if (user.role === "Election Committee") return true;

  const election = await prisma.officerPosition.findUnique({
    where: { slug: "committee-election" },
    select: {
      assignments: {
        where: { userId, active: true },
        select: { id: true },
      },
    },
  });
  return (election?.assignments.length ?? 0) > 0;
}

export async function canManagePortalAdmins(actorUserId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true },
  });
  return u ? isSuperUser(u) : false;
}

/**
 * Label safe to show in the UI. Never reveals super user or internal admin machinery.
 */
export function getDisplayRoleLabel(user: {
  firstName: string;
  lastName: string;
  role: string;
}): string {
  if (isSuperUser(user)) return "Member";
  if (user.role === "Admin") return "Member";
  return user.role;
}

export async function getPrimaryOfficerTitleForUi(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });
  if (u && isSuperUser(u)) return null;

  const rows = await prisma.userOfficerAssignment.findMany({
    where: { userId, active: true },
    orderBy: { position: { sortOrder: "asc" } },
    select: { position: { select: { title: true } }, isChair: true },
  });
  if (rows.length === 0) return null;
  const chair = rows.find((r) => r.isChair);
  if (chair) return chair.position.title;
  return rows[0]?.position.title ?? null;
}
