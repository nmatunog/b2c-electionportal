import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPasswordIfProvided } from "../src/lib/password";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";

const SAFETY_OVERRIDE = process.env.ALLOW_PREVIEW_DB_SEED === "true" || process.env.ALLOW_PREVIEW_DB_RESET === "true";
const PREVIEW_MARKERS = ["preview", "staging", "stage", "sandbox", "localhost", "127.0.0.1", "dev", "test"];

type SeedUser = {
  b2cId: string;
  firstName: string;
  lastName: string;
  tinNo: string;
  dob: string;
  role?: string;
  mobile?: string;
  email?: string;
};

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

const PREVIEW_USERS: SeedUser[] = [
  { b2cId: "B2C-2026-PVW001", firstName: "Nilo", lastName: "Matunog", tinNo: "100000001", dob: "1980-01-12", role: "Election Committee", email: "nilo.preview@example.com" },
  { b2cId: "B2C-2026-PVW002", firstName: "Shelsea", lastName: "Mermida", tinNo: "100000002", dob: "1985-02-14", role: "Member", mobile: "09170000002" },
  { b2cId: "B2C-2026-PVW003", firstName: "Hermelyn", lastName: "Simene", tinNo: "100000003", dob: "1986-03-18", role: "Member", email: "hermelyn.preview@example.com" },
  { b2cId: "B2C-2026-PVW004", firstName: "Dennis", lastName: "Balantucas", tinNo: "100000004", dob: "1982-04-22", role: "Member", mobile: "09170000004" },
  { b2cId: "B2C-2026-PVW005", firstName: "Angelito", lastName: "Barlam", tinNo: "100000005", dob: "1987-05-08", role: "Member", mobile: "09170000005" },
  { b2cId: "B2C-2026-PVW006", firstName: "Adones", lastName: "Cabanig", tinNo: "100000006", dob: "1984-06-30", role: "Member", email: "adones.preview@example.com" },
  { b2cId: "B2C-2026-PVW007", firstName: "Pompey", lastName: "Domingo", tinNo: "100000007", dob: "1988-07-16", role: "Member", email: "pompey.preview@example.com" },
];

const PREVIEW_NOMINATIONS = [
  { nomineeB2cId: "B2C-2026-PVW002", nominatorId: "B2C-2026-PVW001", nomineeName: "Shelsea Mermida", position: "Board of Director" },
  { nomineeB2cId: "B2C-2026-PVW003", nominatorId: "B2C-2026-PVW001", nomineeName: "Hermelyn Simene", position: "Board of Director" },
  { nomineeB2cId: "B2C-2026-PVW004", nominatorId: "B2C-2026-PVW001", nomineeName: "Dennis Balantucas", position: "Board of Director" },
  { nomineeB2cId: "B2C-2026-PVW005", nominatorId: "B2C-2026-PVW001", nomineeName: "Angelito Barlam", position: "Audit Committee" },
  { nomineeB2cId: "B2C-2026-PVW006", nominatorId: "B2C-2026-PVW001", nomineeName: "Adones Cabanig", position: "Audit Committee" },
  { nomineeB2cId: "B2C-2026-PVW006", nominatorId: "B2C-2026-PVW001", nomineeName: "Adones Cabanig", position: "Election Committee" },
  { nomineeB2cId: "B2C-2026-PVW007", nominatorId: "B2C-2026-PVW001", nomineeName: "Pompey Domingo", position: "Election Committee" },
] as const;

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
        "Set ALLOW_PREVIEW_DB_SEED=true only if you are absolutely sure this is safe.",
      ].join("\n"),
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const hashedPassword = await hashPasswordIfProvided("PreviewPass123!");
    if (!hashedPassword) throw new Error("Could not create preview password hash.");

    const summary = await prisma.$transaction(async (tx) => {
      const [votes, nominations, motions, logs, configs, resetUsers] = await Promise.all([
        tx.vote.deleteMany({}),
        tx.nomination.deleteMany({}),
        tx.motion.deleteMany({}),
        tx.governanceLog.deleteMany({}),
        tx.electionConfig.deleteMany({}),
        tx.user.updateMany({ data: { hasVoted: false } }),
      ]);

      let upsertedUsers = 0;
      for (const u of PREVIEW_USERS) {
        await tx.user.upsert({
          where: { b2cId: u.b2cId },
          update: {
            firstName: u.firstName,
            lastName: u.lastName,
            tinNo: u.tinNo,
            dob: new Date(`${u.dob}T00:00:00.000Z`),
            role: u.role ?? "Member",
            mobile: u.mobile ?? null,
            email: u.email ?? null,
            password: hashedPassword,
            hasVoted: false,
            registeredAt: new Date(),
          },
          create: {
            b2cId: u.b2cId,
            firstName: u.firstName,
            lastName: u.lastName,
            tinNo: u.tinNo,
            dob: new Date(`${u.dob}T00:00:00.000Z`),
            role: u.role ?? "Member",
            mobile: u.mobile ?? null,
            email: u.email ?? null,
            password: hashedPassword,
            hasVoted: false,
            registeredAt: new Date(),
          },
        });
        upsertedUsers += 1;
      }

      const createdNominations = await tx.nomination.createMany({
        data: PREVIEW_NOMINATIONS.map((n) => ({
          nomineeB2cId: n.nomineeB2cId,
          nominatorId: n.nominatorId,
          nomineeName: n.nomineeName,
          position: n.position,
          status: "accepted",
          respondedAt: new Date(),
        })),
      });

      await tx.electionConfig.upsert({
        where: { id: 1 },
        update: { status: "nomination", lockedPositions: [] },
        create: { id: 1, status: "nomination", lockedPositions: [] },
      });

      return {
        votesDeleted: votes.count,
        nominationsDeleted: nominations.count,
        motionsDeleted: motions.count,
        logsDeleted: logs.count,
        configsDeleted: configs.count,
        usersReset: resetUsers.count,
        usersUpserted: upsertedUsers,
        nominationsCreated: createdNominations.count,
        loginPassword: "PreviewPass123!",
      };
    });

    console.log("Preview election seed complete.");
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
