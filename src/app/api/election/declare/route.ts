import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { userHasElectionCommitteeAccess } from "@/lib/authz";
import { COMMITTEE_SEATS, COMMITTEES } from "@/lib/election";
import { mergeNominationVotesForCommittee } from "@/lib/nomination-groups";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

function serializeResults(results: Record<string, unknown>): string {
  try {
    return JSON.stringify(results);
  } catch {
    return "{}";
  }
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`election_declare:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: { actorB2cId?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const actorB2cId = typeof body.actorB2cId === "string" ? body.actorB2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!actorB2cId) {
    return NextResponse.json({ ok: false, message: "Missing actorB2cId." }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { b2cId: actorB2cId },
    select: { id: true, b2cId: true, password: true },
  });
  if (!actor) return NextResponse.json({ ok: false, message: "Actor not found." }, { status: 404 });
  if (!(await verifyAndUpgradePassword(actor, password))) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }
  if (!(await userHasElectionCommitteeAccess(actor.id))) {
    return NextResponse.json({ ok: false, message: "Only election committee can declare results." }, { status: 403 });
  }

  const cfg = await prisma.electionConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, status: "nomination", lockedPositions: [] },
    select: { status: true },
  });
  if (cfg.status !== "ended") {
    return NextResponse.json({ ok: false, message: "Set election status to 'ended' before declaring winners." }, { status: 409 });
  }

  const already = await prisma.governanceLog.findFirst({
    where: { action: "RESULTS_DECLARED" },
    orderBy: { timestamp: "desc" },
    select: { id: true, timestamp: true },
  });
  if (already) {
    return NextResponse.json({ ok: true, data: { status: "already_declared", declaredAt: already.timestamp } });
  }

  const nominations = await prisma.nomination.findMany({
    where: { status: "accepted" },
    select: { id: true, nomineeName: true, position: true, nomineeB2cId: true },
  });
  const voteGroups = await prisma.vote.groupBy({
    by: ["committee", "nominationId"],
    _count: { _all: true },
  });
  const tally = new Map<string, number>();
  for (const row of voteGroups) tally.set(row.nominationId, row._count._all);

  const winners = Object.fromEntries(
    COMMITTEES.map((committee) => {
      const forCommittee = nominations
        .filter((n) => n.position === committee)
        .map((n) => ({
          id: n.id,
          position: n.position,
          nomineeName: n.nomineeName,
          nomineeB2cId: n.nomineeB2cId,
        }));
      const merged = mergeNominationVotesForCommittee(forCommittee, (id) => tally.get(id) ?? 0);
      const sorted = merged.map((m) => ({
        nominationId: m.nominationId,
        nomineeName: m.nomineeName,
        votes: m.votes,
        mergedNominationIds: m.mergedNominationIds,
      }));
      return [committee, sorted.slice(0, COMMITTEE_SEATS[committee])];
    }),
  );

  const created = await prisma.governanceLog.create({
    data: {
      user: actor.b2cId,
      action: "RESULTS_DECLARED",
      details: serializeResults({
        declaredAt: new Date().toISOString(),
        winners,
      }),
      userId: actor.id,
    },
    select: { timestamp: true },
  });

  return NextResponse.json({ ok: true, data: { status: "declared", declaredAt: created.timestamp, winners } });
}

