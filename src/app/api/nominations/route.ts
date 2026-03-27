import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

type CreateNominationInput = {
  nomineeName: string;
  position: string;
  nominatorId: string;
  nomineeB2cId: string;
};

type AcceptNominationInput = {
  nominationId: string;
  nomineeB2cId: string;
  password?: string;
  action: "accept";
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCreateInput(body: unknown): { ok: true; data: CreateNominationInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const input = body as Record<string, unknown>;
  const fields = ["nomineeName", "position", "nominatorId", "nomineeB2cId"] as const;
  for (const field of fields) {
    if (!isNonEmptyString(input[field])) {
      return { ok: false, message: `Field '${field}' is required.` };
    }
  }

  return {
    ok: true,
    data: {
      nomineeName: String(input.nomineeName).trim(),
      position: String(input.position).trim(),
      nominatorId: String(input.nominatorId).trim(),
      nomineeB2cId: String(input.nomineeB2cId).trim(),
    },
  };
}

function validateAcceptInput(body: unknown): { ok: true; data: AcceptNominationInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const input = body as Record<string, unknown>;
  if (!isNonEmptyString(input.nominationId) || !isNonEmptyString(input.nomineeB2cId)) {
    return { ok: false, message: "Fields 'nominationId' and 'nomineeB2cId' are required." };
  }
  const action = input.action;
  if (action !== "accept") {
    return { ok: false, message: "Only 'accept' action is supported." };
  }
  return {
    ok: true,
    data: {
      nominationId: String(input.nominationId).trim(),
      nomineeB2cId: String(input.nomineeB2cId).trim(),
      password: typeof input.password === "string" ? input.password : "",
      action: "accept",
    },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const position = searchParams.get("position")?.trim();
  const nominatorId = searchParams.get("nominatorId")?.trim();

  const where = {
    ...(position ? { position } : {}),
    ...(nominatorId ? { nominatorId } : {}),
  };

  const rows = await prisma.nomination.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      nomineeName: true,
      position: true,
      nominatorId: true,
      nomineeB2cId: true,
      status: true,
      respondedAt: true,
      createdAt: true,
      nominator: {
        select: {
          b2cId: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return NextResponse.json({ ok: true, data: rows });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateCreateInput(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, message: validated.message }, { status: 400 });
  }

  try {
    const nomination = await prisma.nomination.create({
      data: {
        nomineeName: validated.data.nomineeName,
        position: validated.data.position,
        nominator: { connect: { b2cId: validated.data.nominatorId } },
        nominee: { connect: { b2cId: validated.data.nomineeB2cId } },
        status: "pending",
      },
      select: {
        id: true,
        nomineeName: true,
        position: true,
        nominatorId: true,
        nomineeB2cId: true,
        status: true,
        respondedAt: true,
        createdAt: true,
        nominator: {
          select: {
            b2cId: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    return NextResponse.json({ ok: true, data: nomination }, { status: 201 });
  } catch (error) {
    const maybeCode =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;

    if (maybeCode === "P2003") {
      return NextResponse.json(
        { ok: false, message: "Invalid nominator or nominee B2C ID." },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: false, message: "Failed to create nomination." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateAcceptInput(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, message: validated.message }, { status: 400 });
  }

  const nomination = await prisma.nomination.findUnique({
    where: { id: validated.data.nominationId },
    select: {
      id: true,
      nomineeB2cId: true,
      status: true,
      nominee: { select: { password: true } },
    },
  });
  if (!nomination) {
    return NextResponse.json({ ok: false, message: "Nomination not found." }, { status: 404 });
  }
  if (!nomination.nomineeB2cId || nomination.nomineeB2cId !== validated.data.nomineeB2cId) {
    return NextResponse.json({ ok: false, message: "Only the nominated member can accept this nomination." }, { status: 403 });
  }
  if (nomination.nominee?.password && nomination.nominee.password !== validated.data.password) {
    return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
  }

  if (nomination.status === "accepted") {
    return NextResponse.json({ ok: true, data: { id: nomination.id, status: "accepted" } });
  }

  const updated = await prisma.nomination.update({
    where: { id: nomination.id },
    data: { status: "accepted", respondedAt: new Date() },
    select: {
      id: true,
      nomineeName: true,
      position: true,
      nominatorId: true,
      nomineeB2cId: true,
      status: true,
      respondedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, data: updated });
}
