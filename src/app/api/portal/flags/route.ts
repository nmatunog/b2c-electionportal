import { NextResponse } from "next/server";

import {
  canManagePortalAdmins,
  getDisplayRoleLabel,
  getPrimaryOfficerTitleForUi,
  userHasElectionCommitteeAccess,
  userHasPortalAdminGrant,
} from "@/lib/authz";
import { prisma } from "@/lib/prisma";

/**
 * Returns safe UI flags for the signed-in member (identified by b2cId + optional password check).
 */
export async function POST(request: Request) {
  let body: { b2cId?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const b2cId = typeof body.b2cId === "string" ? body.b2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!b2cId) {
    return NextResponse.json({ ok: false, message: "Missing b2cId." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { b2cId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      password: true,
    },
  });

  if (!user) {
    return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
  }

  if (user.password && password !== user.password) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }

  const [
    canViewRegistry,
    canManageAdmins,
    canUseElectionCommitteeControls,
    officerTitle,
  ] = await Promise.all([
    userHasPortalAdminGrant(user.id),
    canManagePortalAdmins(user.id),
    userHasElectionCommitteeAccess(user.id),
    getPrimaryOfficerTitleForUi(user.id),
  ]);

  const officerPositions = canManageAdmins
    ? await prisma.officerPosition.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          category: true,
          grantsPortalAdmin: true,
          maxAssignees: true,
        },
      })
    : undefined;

  return NextResponse.json({
    ok: true,
    data: {
      canViewRegistry,
      canManageAdmins,
      canUseElectionCommitteeControls,
      displayRole: getDisplayRoleLabel(user),
      officerTitle,
      officerPositions,
    },
  });
}
