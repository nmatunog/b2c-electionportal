import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

type Row = Record<string, string>;

const inputPath = process.argv[2] ?? "data/official-members.tsv";

function splitLine(line: string, delimiter: "," | "\t"): string[] {
  if (delimiter === "\t") return line.split("\t");

  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseRows(raw: string): Row[] {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  // Skip title line when present.
  const headerLineIndex = lines.findIndex((line) => line.includes("Last Name") && line.includes("First Name"));
  if (headerLineIndex === -1) return [];

  const dataLines = lines.slice(headerLineIndex);
  const delimiter: "," | "\t" = dataLines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(dataLines[0], delimiter).map((h) => h.trim());

  const rows: Row[] = [];
  for (let i = 1; i < dataLines.length; i += 1) {
    const cols = splitLine(dataLines[i], delimiter);
    const row: Row = {};
    headers.forEach((header, idx) => {
      row[header] = (cols[idx] ?? "").trim();
    });
    // Require at least last+first or tin to consider it a row.
    if (row["Last Name"] || row["First Name"] || row["TIN No."]) {
      rows.push(row);
    }
  }
  return rows;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function parseTimestampOrNull(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 24);
}

function fallbackTin(lastName: string, firstName: string, middleName: string): string {
  // Keep members with missing TINs by assigning a deterministic placeholder key.
  const ln = normalizeToken(lastName) || "UNKNOWNLAST";
  const fn = normalizeToken(firstName) || "UNKNOWNFIRST";
  const mn = normalizeToken(middleName) || "NA";
  return `MISSING-${ln}-${fn}-${mn}`;
}

function toObfuscatedToken(value: number): string {
  return value.toString(36).toUpperCase().padStart(6, "0");
}

function fromObfuscatedToken(token: string): number | null {
  const parsed = Number.parseInt(token, 36);
  return Number.isFinite(parsed) ? parsed : null;
}

function randomStart(): number {
  // 6-char base36 gives plenty of room; this keeps initial values non-obvious.
  return Math.floor(Math.random() * 1_000_000) + 250_000;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const raw = await readFile(absolutePath, "utf8");
  const rows = parseRows(raw);

  if (rows.length === 0) {
    throw new Error(`No valid rows found in ${absolutePath}.`);
  }

  const currentYear = new Date().getFullYear();
  const existing = await prisma.user.findMany({ select: { b2cId: true } });
  const maxPerYear = new Map<number, number>();
  for (const user of existing) {
    const match = /^B2C-(\d{4})-([A-Z0-9]{4,})$/i.exec(user.b2cId);
    if (!match) continue;
    const parsedYear = Number(match[1]);
    const parsedNum = fromObfuscatedToken(match[2].toUpperCase());
    if (!Number.isFinite(parsedYear) || parsedNum === null || !Number.isFinite(parsedNum)) continue;
    const prev = maxPerYear.get(parsedYear) ?? 0;
    if (parsedNum > prev) maxPerYear.set(parsedYear, parsedNum);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: string[] = [];

  for (const [idx, row] of rows.entries()) {
    const lastName = normalizeName(row["Last Name"] ?? "");
    const firstName = normalizeName(row["First Name"] ?? "");
    const middleName = normalizeName(row["Middle Name"] ?? "");
    const rawTinNo = onlyDigits(row["TIN No."] ?? "");
    const hasValidTin = rawTinNo.length >= 9;
    const tinNo = hasValidTin ? rawTinNo : fallbackTin(lastName, firstName, middleName);
    const dob = new Date("1970-01-01T00:00:00.000Z");
    const registeredAt = parseTimestampOrNull(row["Timestamp"] ?? "");
    if (!lastName || !firstName) {
      skipped += 1;
      issues.push(`Row ${idx + 1}: skipped (missing last/first name).`);
      continue;
    }

    let existingUser = await prisma.user.findUnique({
      where: { tinNo },
      select: { id: true, b2cId: true },
    });
    if (!existingUser) {
      existingUser = await prisma.user.findFirst({
        where: { lastName, firstName },
        select: { id: true, b2cId: true },
      });
    }

    const idYear = registeredAt?.getFullYear() ?? currentYear;
    const currentMax = maxPerYear.get(idYear) ?? randomStart();
    const nextNum = currentMax + 1;
    const fallbackB2cId = `B2C-${idYear}-${toObfuscatedToken(nextNum)}`;
    if (!existingUser) {
      maxPerYear.set(idYear, nextNum);
    }

    const payload = {
      lastName,
      firstName,
      tinNo,
      dob,
      b2cId: existingUser?.b2cId ?? fallbackB2cId,
      role: "Member",
      registeredAt: registeredAt ?? undefined,
    };

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: payload,
      });
      updated += 1;
    } else {
      await prisma.user.create({
        data: payload,
      });
      created += 1;
    }

    if (!hasValidTin) {
      issues.push(`Row ${idx + 1}: missing/invalid TIN, used placeholder '${tinNo}'.`);
    }
  }

  await prisma.$disconnect();

  console.log(`Import file: ${absolutePath}`);
  console.log(`Rows parsed: ${rows.length}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  if (issues.length > 0) {
    console.log("\nIssues:");
    issues.slice(0, 30).forEach((line) => console.log(`- ${line}`));
    if (issues.length > 30) {
      console.log(`- ... and ${issues.length - 30} more`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
