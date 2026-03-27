import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { PrismaClient } from "../src/generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const POSITIONS: {
  slug: string;
  title: string;
  description: string;
  category: string;
  sortOrder: number;
  grantsPortalAdmin: boolean;
  maxAssignees: number | null;
}[] = [
  {
    slug: "board-chairperson",
    title: "Board Chairperson",
    description: "Chair of the Board of Directors (authorized for portal administration).",
    category: "board",
    sortOrder: 10,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-member-1",
    title: "Member of the Board (Seat 1)",
    description: "Director — cooperative board (authorized for portal administration).",
    category: "board",
    sortOrder: 11,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-member-2",
    title: "Member of the Board (Seat 2)",
    description: "Director — cooperative board (authorized for portal administration).",
    category: "board",
    sortOrder: 12,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-member-3",
    title: "Member of the Board (Seat 3)",
    description: "Director — cooperative board (authorized for portal administration).",
    category: "board",
    sortOrder: 13,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-member-4",
    title: "Member of the Board (Seat 4)",
    description: "Director — cooperative board (authorized for portal administration).",
    category: "board",
    sortOrder: 14,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-member-5",
    title: "Member of the Board (Seat 5)",
    description: "Director — cooperative board (authorized for portal administration).",
    category: "board",
    sortOrder: 15,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "board-vice-chairperson",
    title: "Board Vice-Chairperson",
    description: "Vice-chair of the Board of Directors (authorized for portal administration).",
    category: "board",
    sortOrder: 16,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "general-manager",
    title: "General Manager",
    description: "Chief executive (authorized for portal administration).",
    category: "executive",
    sortOrder: 20,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "accountant",
    title: "Accountant",
    description: "Finance/accounting staff role.",
    category: "executive",
    sortOrder: 21,
    grantsPortalAdmin: false,
    maxAssignees: 1,
  },
  {
    slug: "cashier",
    title: "Cashier",
    description: "Cashiering and front-office financial operations.",
    category: "executive",
    sortOrder: 22,
    grantsPortalAdmin: false,
    maxAssignees: 1,
  },
  {
    slug: "secretary",
    title: "Secretary",
    description: "Corporate secretary (CDA reporting and records).",
    category: "executive",
    sortOrder: 30,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "treasurer",
    title: "Treasurer",
    description: "Financial officer (CDA financial reporting).",
    category: "executive",
    sortOrder: 31,
    grantsPortalAdmin: true,
    maxAssignees: 1,
  },
  {
    slug: "committee-audit",
    title: "Audit Committee",
    description: "Internal audit oversight (CDA-aligned).",
    category: "committee",
    sortOrder: 40,
    grantsPortalAdmin: true,
    maxAssignees: null,
  },
  {
    slug: "committee-election",
    title: "Election Committee",
    description: "Conduct of elections (members authorized for portal administration).",
    category: "committee",
    sortOrder: 41,
    grantsPortalAdmin: true,
    maxAssignees: null,
  },
  {
    slug: "committee-education",
    title: "Membership, Education and Training Committee",
    description: "Member education and cooperative training (CDA-aligned).",
    category: "committee",
    sortOrder: 42,
    grantsPortalAdmin: false,
    maxAssignees: null,
  },
  {
    slug: "committee-ethics",
    title: "Ethics Committee",
    description: "Ethics and standards oversight.",
    category: "committee",
    sortOrder: 43,
    grantsPortalAdmin: false,
    maxAssignees: null,
  },
  {
    slug: "committee-gad",
    title: "Gender and Development Committee",
    description: "Gender and development committee.",
    category: "committee",
    sortOrder: 44,
    grantsPortalAdmin: false,
    maxAssignees: null,
  },
  {
    slug: "committee-mediation",
    title: "Mediation and Conciliation Committee",
    description: "Dispute mediation and conciliation among members (CDA-aligned).",
    category: "committee",
    sortOrder: 45,
    grantsPortalAdmin: false,
    maxAssignees: null,
  },
];

type AssignmentSeed = {
  positionSlug: string;
  aliases: string[];
  isChair?: boolean;
};

const ASSIGNMENTS: AssignmentSeed[] = [
  // Board of Directors
  { positionSlug: "board-chairperson", aliases: ["Nilo Matunog"], isChair: true },
  {
    positionSlug: "board-vice-chairperson",
    aliases: ["Marcelius Thomas Aleguiojo Jr", "Marcelius Thomas Aleguiojo, Jr"],
  },
  { positionSlug: "board-member-1", aliases: ["Dennis Balantucas"] },
  { positionSlug: "board-member-2", aliases: ["Angelito Barlam"] },
  { positionSlug: "board-member-3", aliases: ["Marshallie Cabana", "Marshallie Cabaña"] },

  // Executive officers
  { positionSlug: "secretary", aliases: ["Shelsea Mermida"] },
  { positionSlug: "treasurer", aliases: ["Hermelyn Simene"] },
  { positionSlug: "general-manager", aliases: ["Lydia Canalija"] },
  { positionSlug: "accountant", aliases: ["Ken Roy Cardanio"] },

  // Committees
  { positionSlug: "committee-audit", aliases: ["Adones Cabanig"], isChair: true },
  { positionSlug: "committee-audit", aliases: ["Christine Frances Morales"] },
  { positionSlug: "committee-audit", aliases: ["Marcos Cecilio Macariola"] },

  { positionSlug: "committee-election", aliases: ["Pompey Domingo"], isChair: true },
  { positionSlug: "committee-election", aliases: ["Hartzell Sagun"] },
  { positionSlug: "committee-election", aliases: ["Roel Joshua Gingoyon"] },

  {
    positionSlug: "committee-education",
    aliases: ["Marcelius Thomas Aleguiojo Jr", "Marcelius Thomas Aleguiojo, Jr"],
    isChair: true,
  },
  { positionSlug: "committee-ethics", aliases: ["Alfredo Mallo II"], isChair: true },
  { positionSlug: "committee-gad", aliases: ["Lester Raymond Laluces"], isChair: true },
];

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      b2cId: true,
    },
  });

  const userIndex = new Map<string, { id: string; b2cId: string; fullName: string }>();
  for (const u of users) {
    const fullName = `${u.firstName} ${u.lastName}`.replace(/\s+/g, " ").trim();
    userIndex.set(normalizeName(fullName), { id: u.id, b2cId: u.b2cId, fullName });
  }

  for (const p of POSITIONS) {
    await prisma.officerPosition.upsert({
      where: { slug: p.slug },
      create: p,
      update: {
        title: p.title,
        description: p.description,
        category: p.category,
        sortOrder: p.sortOrder,
        grantsPortalAdmin: p.grantsPortalAdmin,
        maxAssignees: p.maxAssignees,
      },
    });
  }

  const positions = await prisma.officerPosition.findMany({
    select: { id: true, slug: true, title: true },
  });
  const positionIndex = new Map(positions.map((p) => [p.slug, p]));

  let assignmentCount = 0;
  const missingUsers: string[] = [];
  const missingPositions: string[] = [];

  for (const seed of ASSIGNMENTS) {
    const position = positionIndex.get(seed.positionSlug);
    if (!position) {
      missingPositions.push(seed.positionSlug);
      continue;
    }

    const matchedUser = seed.aliases
      .map((alias) => userIndex.get(normalizeName(alias)))
      .find((u): u is { id: string; b2cId: string; fullName: string } => Boolean(u));

    if (!matchedUser) {
      missingUsers.push(seed.aliases[0]);
      continue;
    }

    await prisma.userOfficerAssignment.upsert({
      where: {
        userId_positionId: {
          userId: matchedUser.id,
          positionId: position.id,
        },
      },
      create: {
        userId: matchedUser.id,
        positionId: position.id,
        isChair: seed.isChair ?? false,
        active: true,
      },
      update: {
        isChair: seed.isChair ?? false,
        active: true,
      },
    });
    assignmentCount += 1;
  }

  console.log(`Seeded ${POSITIONS.length} officer positions.`);
  console.log(`Upserted ${assignmentCount} officer assignments.`);
  if (missingPositions.length > 0) {
    console.log(`Missing positions (${missingPositions.length}): ${missingPositions.join(", ")}`);
  }
  if (missingUsers.length > 0) {
    console.log(`Missing users (${missingUsers.length}): ${missingUsers.join(", ")}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
