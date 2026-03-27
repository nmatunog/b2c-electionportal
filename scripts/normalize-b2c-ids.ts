import "dotenv/config";
import { randomInt } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";

function pickYear(existingB2cId: string, registeredAt: Date | null): number {
  const match = /^B2C-(\d{4})-[A-Z0-9]+$/i.exec(existingB2cId);
  if (match) return Number(match[1]);
  if (registeredAt) return registeredAt.getFullYear();
  return new Date().getFullYear();
}

function generateToken(): string {
  // 36^6 ~= 2.17B possibilities; uppercase for consistency.
  const n = randomInt(0, 36 ** 6);
  return n.toString(36).toUpperCase().padStart(6, "0");
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const users = await prisma.user.findMany({
    select: { id: true, b2cId: true, registeredAt: true, firstName: true, lastName: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (users.length === 0) {
    console.log("No users found. Nothing to normalize.");
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const reserved = new Set(users.map((u) => u.b2cId));
  const mapping: Array<{ id: string; oldB2cId: string; newB2cId: string; name: string }> = [];

  for (const user of users) {
    const year = pickYear(user.b2cId, user.registeredAt);
    let next = "";
    for (let i = 0; i < 100; i += 1) {
      const candidate = `B2C-${year}-${generateToken()}`;
      if (!reserved.has(candidate)) {
        next = candidate;
        break;
      }
    }
    if (!next) {
      throw new Error(`Could not generate a unique B2C ID for ${user.firstName} ${user.lastName}.`);
    }
    reserved.add(next);
    mapping.push({
      id: user.id,
      oldB2cId: user.b2cId,
      newB2cId: next,
      name: `${user.firstName} ${user.lastName}`,
    });
  }

  await prisma.$transaction(
    mapping.map((m) =>
      prisma.user.update({
        where: { id: m.id },
        data: { b2cId: m.newB2cId },
      }),
    ),
  );

  const totalUsers = await prisma.user.count();
  const nominationRefs = await prisma.nomination.count({
    where: {
      OR: [{ nominatorId: { startsWith: "B2C-" } }, { nomineeB2cId: { startsWith: "B2C-" } }],
    },
  });
  const voteRefs = await prisma.vote.count({ where: { voterId: { startsWith: "B2C-" } } });
  const motionRefs = await prisma.motion.count({ where: { moverId: { startsWith: "B2C-" } } });

  console.log(`Normalized B2C IDs for ${mapping.length} users.`);
  console.log(`Users in DB: ${totalUsers}`);
  console.log(`Rows with B2C references -> nominations: ${nominationRefs}, votes: ${voteRefs}, motions: ${motionRefs}`);
  console.log("");
  console.log("Sample mappings:");
  mapping.slice(0, 10).forEach((m) => {
    console.log(`- ${m.name}: ${m.oldB2cId} -> ${m.newB2cId}`);
  });
  if (mapping.length > 10) {
    console.log(`- ...and ${mapping.length - 10} more`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

