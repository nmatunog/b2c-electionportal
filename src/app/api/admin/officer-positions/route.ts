import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { userHasPortalAdminGrant } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

/**
 * Update officer position title/description (portal admins and super user).
 */
export async function PATCH(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`officer_positions:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: {
    b2cId?: string;
    password?: string;
    positionId?: string;
    title?: string;
    description?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const b2cId = typeof body.b2cId === "string" ? body.b2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const positionId = typeof body.positionId === "string" ? body.positionId.trim() : "";

  if (!b2cId || !positionId) {
    return NextResponse.json({ ok: false, message: "Missing b2cId or positionId." }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { b2cId },
    select: { id: true, password: true },
  });
  if (!actor) return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
  if (!(await verifyAndUpgradePassword(actor, password))) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }
  if (!(await userHasPortalAdminGrant(actor.id))) {
    return NextResponse.json({ ok: false, message: "Forbidden." }, { status: 403 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  if (!title) {
    return NextResponse.json({ ok: false, message: "Missing title." }, { status: 400 });
  }

  const updated = await prisma.officerPosition.update({
    where: { id: positionId },
    data: {
      title,
      description: body.description === undefined ? undefined : body.description,
    },
    select: { id: true, slug: true, title: true, description: true },
  });

  return NextResponse.json({ ok: true, data: updated });
}
