import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { userHasElectionCommitteeAccess } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

async function getOrCreateConfig() {
  return prisma.electionConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, status: "nomination", lockedPositions: [] },
    select: { id: true, status: true, lockedPositions: true, updatedAt: true },
  });
}

export async function GET() {
  const cfg = await getOrCreateConfig();
  return NextResponse.json({ ok: true, data: cfg });
}

export async function PATCH(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`election_config:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: {
    actorB2cId?: string;
    password?: string;
    status?: string;
    lockedPositions?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const actorB2cId = typeof body.actorB2cId === "string" ? body.actorB2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const status = typeof body.status === "string" ? body.status.trim() : undefined;
  const lockedPositions = Array.isArray(body.lockedPositions)
    ? body.lockedPositions.filter((p): p is string => typeof p === "string").map((p) => p.trim())
    : undefined;

  if (!actorB2cId) {
    return NextResponse.json({ ok: false, message: "Missing actorB2cId." }, { status: 400 });
  }
  if (status && !["nomination", "voting", "ended"].includes(status)) {
    return NextResponse.json({ ok: false, message: "Invalid election status." }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { b2cId: actorB2cId },
    select: { id: true, password: true },
  });
  if (!actor) return NextResponse.json({ ok: false, message: "Actor not found." }, { status: 404 });
  if (!(await verifyAndUpgradePassword(actor, password))) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }
  if (!(await userHasElectionCommitteeAccess(actor.id))) {
    return NextResponse.json({ ok: false, message: "Only election committee can update election settings." }, { status: 403 });
  }

  const current = await getOrCreateConfig();
  if (current.status === "ended") {
    // Freeze election controls once polls are closed.
    const tryingToChangeStatus = status != null && status !== "ended";
    const tryingToChangeLocks = lockedPositions != null;
    if (tryingToChangeStatus || tryingToChangeLocks) {
      return NextResponse.json(
        { ok: false, message: "Election is finalized and configuration is frozen." },
        { status: 409 },
      );
    }
  }

  const cfg = await prisma.electionConfig.upsert({
    where: { id: 1 },
    update: {
      ...(status ? { status } : {}),
      ...(lockedPositions ? { lockedPositions } : {}),
    },
    create: {
      id: 1,
      status: status ?? "nomination",
      lockedPositions: lockedPositions ?? [],
    },
    select: { id: true, status: true, lockedPositions: true, updatedAt: true },
  });

  return NextResponse.json({ ok: true, data: cfg });
}

