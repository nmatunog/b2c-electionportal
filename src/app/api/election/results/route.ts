import { NextResponse } from "next/server";

import { COMMITTEE_SEATS, COMMITTEES } from "@/lib/election";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const nominations = await prisma.nomination.findMany({
    where: { status: "accepted" },
    select: { id: true, nomineeName: true, position: true },
  });

  const voteGroups = await prisma.vote.groupBy({
    by: ["committee", "nominationId"],
    _count: { _all: true },
  });

  const tally = new Map<string, number>();
  for (const row of voteGroups) {
    tally.set(row.nominationId, row._count._all);
  }

  const byCommittee = Object.fromEntries(
    COMMITTEES.map((committee) => {
      const entries = nominations
        .filter((n) => n.position === committee)
        .map((n) => ({
          nominationId: n.id,
          nomineeName: n.nomineeName,
          votes: tally.get(n.id) ?? 0,
        }))
        .sort((a, b) => b.votes - a.votes);

      return [
        committee,
        {
          seats: COMMITTEE_SEATS[committee],
          candidates: entries,
          winners: entries.slice(0, COMMITTEE_SEATS[committee]),
        },
      ];
    }),
  );

  const declared = await prisma.governanceLog.findFirst({
    where: { action: "RESULTS_DECLARED" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });

  return NextResponse.json({
    ok: true,
    data: {
      byCommittee,
      declaredAt: declared?.timestamp ?? null,
    },
  });
}

