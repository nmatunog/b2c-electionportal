import { NextResponse } from "next/server";

import { COMMITTEE_SEATS, COMMITTEES } from "@/lib/election";
import { mergeNominationVotesForCommittee } from "@/lib/nomination-groups";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const nominations = await prisma.nomination.findMany({
    where: { status: "accepted" },
    select: { id: true, nomineeName: true, position: true, nomineeB2cId: true },
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
      const forCommittee = nominations
        .filter((n) => n.position === committee)
        .map((n) => ({
          id: n.id,
          position: n.position,
          nomineeName: n.nomineeName,
          nomineeB2cId: n.nomineeB2cId,
        }));
      const merged = mergeNominationVotesForCommittee(forCommittee, (id) => tally.get(id) ?? 0);
      const entries = merged.map((m) => ({
        nominationId: m.nominationId,
        nomineeName: m.nomineeName,
        votes: m.votes,
        mergedNominationIds: m.mergedNominationIds,
      }));

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

  const [registeredMembers, membersWhoVoted] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { hasVoted: true } }),
  ]);

  return NextResponse.json({
    ok: true,
    data: {
      byCommittee,
      declaredAt: declared?.timestamp ?? null,
      voterStats: {
        registeredMembers,
        membersWhoVoted,
      },
    },
  });
}

