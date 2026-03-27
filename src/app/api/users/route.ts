import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { isSuperUser } from "@/lib/super-user";

type CreateUserInput = {
  lastName: string;
  firstName: string;
  b2cId: string;
  tinNo: string;
  dob: string;
  role?: string;
  mobile?: string;
  email?: string;
  password?: string;
  registeredAt?: string;
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

function validateCreateUserInput(body: unknown): { ok: true; data: CreateUserInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const input = body as Record<string, unknown>;
  const required = ["lastName", "firstName", "b2cId", "tinNo", "dob"] as const;
  for (const field of required) {
    if (!isNonEmptyString(input[field])) {
      return { ok: false, message: `Field '${field}' is required.` };
    }
  }

  return {
    ok: true,
    data: {
      lastName: String(input.lastName).trim(),
      firstName: String(input.firstName).trim(),
      b2cId: String(input.b2cId).trim(),
      tinNo: String(input.tinNo).trim(),
      dob: String(input.dob).trim(),
      role: parseOptionalString(input.role),
      mobile: parseOptionalString(input.mobile),
      email: parseOptionalString(input.email),
      password: parseOptionalString(input.password),
      registeredAt: parseOptionalString(input.registeredAt),
    },
  };
}

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      b2cId: true,
      tinNo: true,
      dob: true,
      role: true,
      mobile: true,
      email: true,
      hasVoted: true,
      registeredAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const data = users.map((u) => ({
    ...u,
    role: isSuperUser(u) ? "Member" : u.role,
  }));

  return NextResponse.json({ ok: true, data });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateCreateUserInput(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, message: validated.message }, { status: 400 });
  }

  const dobDate = parseDate(validated.data.dob);
  if (!dobDate) {
    return NextResponse.json({ ok: false, message: "Field 'dob' must be a valid date string." }, { status: 400 });
  }

  const registeredAtDate = validated.data.registeredAt ? parseDate(validated.data.registeredAt) : undefined;
  if (validated.data.registeredAt && !registeredAtDate) {
    return NextResponse.json(
      { ok: false, message: "Field 'registeredAt' must be a valid date string when provided." },
      { status: 400 },
    );
  }

  try {
    const user = await prisma.user.create({
      data: {
        lastName: validated.data.lastName,
        firstName: validated.data.firstName,
        b2cId: validated.data.b2cId,
        tinNo: validated.data.tinNo,
        dob: dobDate,
        role: validated.data.role ?? "Member",
        mobile: validated.data.mobile,
        email: validated.data.email,
        password: validated.data.password,
        registeredAt: registeredAtDate,
      },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        b2cId: true,
        role: true,
        mobile: true,
        email: true,
        hasVoted: true,
        registeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, data: user }, { status: 201 });
  } catch (error) {
    const maybeCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (maybeCode === "P2002") {
      return NextResponse.json({ ok: false, message: "User with the same b2cId or tinNo already exists." }, { status: 409 });
    }

    return NextResponse.json({ ok: false, message: "Failed to create user." }, { status: 500 });
  }
}
