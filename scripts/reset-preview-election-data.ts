import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";

const SAFETY_OVERRIDE = process.env.ALLOW_PREVIEW_DB_RESET === "true";
const PREVIEW_MARKERS = ["preview", "staging", "stage", "sandbox", "localhost", "127.0.0.1", "dev", "test"];

function isPreviewLikeDatabase(url: string): boolean {
  const lower = url.toLowerCase();
  return PREVIEW_MARKERS.some((marker) => lower.includes(marker));
}

function parseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const vercelEnv = process.env.VERCEL_ENV?.toLowerCase() ?? "";
  const previewByEnv = vercelEnv === "preview" || vercelEnv === "development";
  const previewByUrl = isPreviewLikeDatabase(databaseUrl);

  if (!SAFETY_OVERRIDE && !previewByEnv && !previewByUrl) {
    throw new Error(
      [
        "Safety check failed: target database does not look like a preview/staging DB.",
        `Resolved host: ${parseHost(databaseUrl)}`,
        "Set ALLOW_PREVIEW_DB_RESET=true only if you are absolutely sure this is safe.",
      ].join("\n"),
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const [votes, nominations, motions, logs, configs, resetUsers] = await Promise.all([
        tx.vote.deleteMany({}),
        tx.nomination.deleteMany({}),
        tx.motion.deleteMany({}),
        tx.governanceLog.deleteMany({}),
        tx.electionConfig.deleteMany({}),
        tx.user.updateMany({ data: { hasVoted: false } }),
      ]);
      return {
        votes: votes.count,
        nominations: nominations.count,
        motions: motions.count,
        logs: logs.count,
        electionConfigs: configs.count,
        usersReset: resetUsers.count,
      };
    });

    console.log("Preview election data reset complete.");
    console.log(`Host: ${parseHost(databaseUrl)}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
