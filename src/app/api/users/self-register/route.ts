import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type SelfRegisterInput = {
  lastName: string;
  firstName: string;
  tinNo: string;
  dob: string;
  mobile?: string;
  email?: string;
  password?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeUpper(value: string): string {
  return value.trim().toUpperCase();
}

async function generateUniqueB2cId(): Promise<string> {
  const year = new Date().getFullYear();
  for (let i = 0; i < 20; i += 1) {
    const token = Math.random().toString(36).slice(2, 8).toUpperCase();
    const b2cId = `B2C-${year}-${token}`;
    const exists = await prisma.user.findUnique({ where: { b2cId }, select: { id: true } });
    if (!exists) return b2cId;
  }
  return `B2C-${year}-${Date.now().toString(36).toUpperCase()}`;
}

function validateBody(body: unknown): { ok: true; data: SelfRegisterInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  const required = ["lastName", "firstName", "tinNo", "dob"] as const;
  for (const field of required) {
    if (!isNonEmptyString(input[field])) {
      return { ok: false, message: `Field '${field}' is required.` };
    }
  }

  const mobile = parseOptionalString(input.mobile);
  const email = parseOptionalString(input.email);
  if (!mobile && !email) {
    return { ok: false, message: "Provide at least one contact detail: mobile or email." };
  }

  return {
    ok: true,
    data: {
      lastName: String(input.lastName).trim(),
      firstName: String(input.firstName).trim(),
      tinNo: String(input.tinNo).trim(),
      dob: String(input.dob).trim(),
      mobile,
      email,
      password: parseOptionalString(input.password),
    },
  };
}

/**
 * Self-registration for members with incomplete/missing registry records.
 * Minimum identity: DOB + TIN + contact detail (mobile/email).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, message: validated.message }, { status: 400 });
  }

  const dobDate = parseDate(validated.data.dob);
  if (!dobDate) {
    return NextResponse.json({ ok: false, message: "Field 'dob' must be a valid date string." }, { status: 400 });
  }

  const normalizedTin = onlyDigits(validated.data.tinNo);
  if (normalizedTin.length < 9) {
    return NextResponse.json({ ok: false, message: "TIN must contain at least 9 digits." }, { status: 400 });
  }

  const normalizedLast = normalizeUpper(validated.data.lastName);
  const normalizedFirst = normalizeUpper(validated.data.firstName);

  try {
    let user = await prisma.user.findUnique({
      where: { tinNo: normalizedTin },
      select: { id: true, b2cId: true },
    });

    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          AND: [
            { lastName: { equals: normalizedLast, mode: "insensitive" } },
            { firstName: { equals: normalizedFirst, mode: "insensitive" } },
          ],
        },
        select: { id: true, b2cId: true },
      });
    }

    const payload = {
      lastName: normalizedLast,
      firstName: normalizedFirst,
      tinNo: normalizedTin,
      dob: dobDate,
      mobile: validated.data.mobile,
      email: validated.data.email,
      password: validated.data.password,
      role: "Member",
      registeredAt: new Date(),
    };

    const saved = user
      ? await prisma.user.update({
          where: { id: user.id },
          data: payload,
          select: {
            id: true,
            lastName: true,
            firstName: true,
            b2cId: true,
            role: true,
            tinNo: true,
            dob: true,
            mobile: true,
            email: true,
            hasVoted: true,
            registeredAt: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : await prisma.user.create({
          data: {
            ...payload,
            b2cId: await generateUniqueB2cId(),
          },
          select: {
            id: true,
            lastName: true,
            firstName: true,
            b2cId: true,
            role: true,
            tinNo: true,
            dob: true,
            mobile: true,
            email: true,
            hasVoted: true,
            registeredAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });

    return NextResponse.json({ ok: true, data: saved }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not complete self-registration." }, { status: 500 });
  }
}

