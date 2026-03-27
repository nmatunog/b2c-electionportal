import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { COMMITTEE_SEATS, COMMITTEES } from "@/lib/election";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

type CastBallotBody = {
  voterB2cId?: string;
  password?: string;
  ballot?: Record<string, string[]>;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`votes:${ip}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: CastBallotBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const voterB2cId = typeof body.voterB2cId === "string" ? body.voterB2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const ballot = body.ballot ?? {};

  if (!voterB2cId) {
    return NextResponse.json({ ok: false, message: "Missing voterB2cId." }, { status: 400 });
  }

  for (const committee of COMMITTEES) {
    const picks = ballot[committee];
    if (!isStringArray(picks)) {
      return NextResponse.json({ ok: false, message: `Missing ballot selections for '${committee}'.` }, { status: 400 });
    }
    if (picks.length !== COMMITTEE_SEATS[committee]) {
      return NextResponse.json(
        { ok: false, message: `Committee '${committee}' requires exactly ${COMMITTEE_SEATS[committee]} selections.` },
        { status: 400 },
      );
    }
    if (new Set(picks).size !== picks.length) {
      return NextResponse.json({ ok: false, message: `Duplicate selections found in '${committee}'.` }, { status: 400 });
    }
  }

  const allNominationIds = COMMITTEES.flatMap((c) => ballot[c]);
  if (new Set(allNominationIds).size !== allNominationIds.length) {
    return NextResponse.json({ ok: false, message: "A nomination can only be selected once per ballot." }, { status: 400 });
  }

  const voter = await prisma.user.findUnique({
    where: { b2cId: voterB2cId },
    select: { id: true, b2cId: true, password: true, hasVoted: true },
  });
  if (!voter) return NextResponse.json({ ok: false, message: "Voter not found." }, { status: 404 });
  if (!(await verifyAndUpgradePassword(voter, password))) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }
  if (voter.hasVoted) {
    return NextResponse.json({ ok: false, message: "This member has already cast a ballot." }, { status: 409 });
  }

  const config = await prisma.electionConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, status: "nomination", lockedPositions: [] },
    select: { status: true },
  });
  if (config.status !== "voting") {
    return NextResponse.json({ ok: false, message: "Voting is not open." }, { status: 409 });
  }

  const nominations = await prisma.nomination.findMany({
    where: {
      id: { in: allNominationIds },
      status: "accepted",
    },
    select: { id: true, position: true },
  });
  if (nominations.length !== allNominationIds.length) {
    return NextResponse.json({ ok: false, message: "One or more selected nominees are invalid or not accepted." }, { status: 400 });
  }
  const nomById = new Map(nominations.map((n) => [n.id, n.position]));
  for (const committee of COMMITTEES) {
    for (const id of ballot[committee]) {
      const position = nomById.get(id);
      if (position !== committee) {
        return NextResponse.json(
          { ok: false, message: `Nominee selection does not match committee '${committee}'.` },
          { status: 400 },
        );
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vote.createMany({
        data: COMMITTEES.flatMap((committee) =>
          ballot[committee].map((nominationId) => ({
            voterId: voter.b2cId,
            nominationId,
            committee,
          })),
        ),
      });
      await tx.user.update({
        where: { id: voter.id },
        data: { hasVoted: true },
      });
      await tx.governanceLog.create({
        data: {
          user: voter.b2cId,
          action: "VOTE_CAST",
          details: "Ballot cast via secure voting endpoint.",
          userId: voter.id,
        },
      });
    });
  } catch (error) {
    const maybeCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (maybeCode === "P2002") {
      return NextResponse.json({ ok: false, message: "Duplicate vote detected." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: "Failed to cast ballot." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: { status: "recorded" } }, { status: 201 });
}

