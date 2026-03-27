import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { COMMITTEE_SEATS, COMMITTEES } from "../src/lib/election";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const failures: string[] = [];

  const duplicateVotes = await prisma.vote.groupBy({
    by: ["voterId", "nominationId"],
    _count: { _all: true },
  });
  const duplicateVoteRows = duplicateVotes.filter((r) => r._count._all > 1);
  if (duplicateVoteRows.length > 0) {
    failures.push(`Duplicate vote rows found: ${duplicateVoteRows.length}`);
  }

  const invalidCommitteeVotes = await prisma.vote.count({
    where: {
      committee: { notIn: COMMITTEES as string[] },
    },
  });
  if (invalidCommitteeVotes > 0) {
    failures.push(`Votes with unknown committee labels: ${invalidCommitteeVotes}`);
  }

  const pendingVoted = await prisma.vote.count({
    where: {
      nomination: { status: { not: "accepted" } },
    },
  });
  if (pendingVoted > 0) {
    failures.push(`Votes linked to non-accepted nominations: ${pendingVoted}`);
  }

  const missingHasVoted = await prisma.user.count({
    where: {
      votes: { some: {} },
      hasVoted: false,
    },
  });
  if (missingHasVoted > 0) {
    failures.push(`Users with votes but hasVoted=false: ${missingHasVoted}`);
  }

  const tooManyPerCommittee = await Promise.all(
    COMMITTEES.map(async (committee) => {
      const over = await prisma.vote.groupBy({
        by: ["voterId"],
        where: { committee },
        _count: { _all: true },
      });
      return { committee, count: over.filter((r) => r._count._all > COMMITTEE_SEATS[committee]).length };
    }),
  );
  for (const row of tooManyPerCommittee) {
    if (row.count > 0) {
      failures.push(`Voters exceeding seat limit in ${row.committee}: ${row.count}`);
    }
  }

  if (failures.length > 0) {
    console.error("Election invariant check FAILED:");
    failures.forEach((f) => console.error(`- ${f}`));
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  }

  console.log("Election invariant check passed.");
  console.log(
    JSON.stringify(
      {
        users: await prisma.user.count(),
        nominations: await prisma.nomination.count(),
        votes: await prisma.vote.count(),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

