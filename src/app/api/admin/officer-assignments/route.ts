import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { canManagePortalAdmins } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

/**
 * Assign or unassign a member to an officer position. Super user only (portal admin grants).
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`officer_assignments:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: {
    actorB2cId?: string;
    password?: string;
    userB2cId?: string;
    positionSlug?: string;
    action?: "assign" | "unassign";
    isChair?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const actorB2cId = typeof body.actorB2cId === "string" ? body.actorB2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const userB2cId = typeof body.userB2cId === "string" ? body.userB2cId.trim() : "";
  const positionSlug = typeof body.positionSlug === "string" ? body.positionSlug.trim() : "";
  const action = body.action;

  if (!actorB2cId || !userB2cId || !positionSlug || (action !== "assign" && action !== "unassign")) {
    return NextResponse.json({ ok: false, message: "Invalid body." }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { b2cId: actorB2cId },
    select: { id: true, password: true },
  });
  if (!actor) return NextResponse.json({ ok: false, message: "Actor not found." }, { status: 404 });
  if (!(await verifyAndUpgradePassword(actor, password))) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }
  if (!(await canManagePortalAdmins(actor.id))) {
    return NextResponse.json({ ok: false, message: "Only the authorized super user may change assignments." }, { status: 403 });
  }

  const subject = await prisma.user.findUnique({
    where: { b2cId: userB2cId },
    select: { id: true },
  });
  if (!subject) return NextResponse.json({ ok: false, message: "Member not found." }, { status: 404 });

  const position = await prisma.officerPosition.findUnique({
    where: { slug: positionSlug },
    select: { id: true, maxAssignees: true, grantsPortalAdmin: true },
  });
  if (!position) return NextResponse.json({ ok: false, message: "Position not found." }, { status: 404 });

  if (action === "unassign") {
    await prisma.userOfficerAssignment.deleteMany({
      where: { userId: subject.id, positionId: position.id },
    });
    return NextResponse.json({ ok: true, data: { action: "unassign" } });
  }

  if (position.maxAssignees != null) {
    const count = await prisma.userOfficerAssignment.count({
      where: { positionId: position.id, active: true },
    });
    if (count >= position.maxAssignees) {
      return NextResponse.json({ ok: false, message: "This position is already filled." }, { status: 409 });
    }
  }

  const isChair = Boolean(body.isChair);

  await prisma.userOfficerAssignment.upsert({
    where: {
      userId_positionId: { userId: subject.id, positionId: position.id },
    },
    create: {
      userId: subject.id,
      positionId: position.id,
      isChair,
      active: true,
    },
    update: { isChair, active: true },
  });

  return NextResponse.json({ ok: true, data: { action: "assign" } });
}
