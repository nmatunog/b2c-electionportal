import { NextResponse } from "next/server";

import { verifyAndUpgradePassword } from "@/lib/auth-password";
import { userCanManageNominations } from "@/lib/authz";
import { COMMITTEES } from "@/lib/election";
import { nominationCandidateKey } from "@/lib/nomination-groups";
import { prisma } from "@/lib/prisma";
import { getClientIp, takeRateLimit } from "@/lib/rate-limit";

function isCommitteePosition(value: string): boolean {
  return COMMITTEES.includes(value as (typeof COMMITTEES)[number]);
}

async function assertElectionNotFinalized(): Promise<{ ok: false; status: number; message: string } | { ok: true }> {
  const cfg = await prisma.electionConfig.findUnique({
    where: { id: 1 },
    select: { status: true },
  });
  if (cfg?.status === "ended") {
    return { ok: false, status: 409, message: "Election is finalized; nominations cannot be changed." };
  }
  return { ok: true };
}

type ActorBody = {
  actorB2cId?: string;
  password?: string;
};

async function authorizeActor(body: ActorBody): Promise<
  | { ok: true; actor: { id: string; b2cId: string; password: string | null } }
  | { ok: false; status: number; message: string }
> {
  const actorB2cId = typeof body.actorB2cId === "string" ? body.actorB2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!actorB2cId) {
    return { ok: false, status: 400, message: "Missing actorB2cId." };
  }
  const actor = await prisma.user.findUnique({
    where: { b2cId: actorB2cId },
    select: { id: true, b2cId: true, password: true },
  });
  if (!actor) return { ok: false, status: 404, message: "Actor not found." };
  if (!(await verifyAndUpgradePassword(actor, password))) {
    return { ok: false, status: 401, message: "Invalid password." };
  }
  if (!(await userCanManageNominations(actor.id))) {
    return { ok: false, status: 403, message: "Only portal administrators or election committee may manage nominations." };
  }
  return { ok: true, actor };
}

const nominationSelect = {
  id: true,
  nomineeName: true,
  position: true,
  nominatorId: true,
  nomineeB2cId: true,
  status: true,
  respondedAt: true,
  createdAt: true,
  nominator: {
    select: { b2cId: true, firstName: true, lastName: true },
  },
} as const;

/** Create nomination on behalf (admin / election committee). */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`admin_nominations:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: ActorBody & {
    nominatorId?: string;
    nomineeB2cId?: string;
    position?: string;
    nomineeName?: string;
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const auth = await authorizeActor(body);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const frozen = await assertElectionNotFinalized();
  if (!frozen.ok) return NextResponse.json({ ok: false, message: frozen.message }, { status: frozen.status });

  const nominatorId = typeof body.nominatorId === "string" ? body.nominatorId.trim() : "";
  const nomineeB2cId = typeof body.nomineeB2cId === "string" ? body.nomineeB2cId.trim() : "";
  const position = typeof body.position === "string" ? body.position.trim() : "";
  const nomineeName = typeof body.nomineeName === "string" ? body.nomineeName.trim() : "";
  const status = body.status === "accepted" || body.status === "pending" ? body.status : "pending";

  if (!nominatorId || !nomineeB2cId || !position || !nomineeName) {
    return NextResponse.json(
      { ok: false, message: "nominatorId, nomineeB2cId, position, and nomineeName are required." },
      { status: 400 },
    );
  }
  if (!isCommitteePosition(position)) {
    return NextResponse.json({ ok: false, message: "Invalid committee position." }, { status: 400 });
  }

  const newKey = nominationCandidateKey({
    position,
    nomineeName,
    nomineeB2cId,
  });
  const existingForPosition = await prisma.nomination.findMany({
    where: { position },
    select: { nomineeName: true, position: true, nomineeB2cId: true },
  });
  for (const row of existingForPosition) {
    if (
      nominationCandidateKey({
        position: row.position,
        nomineeName: row.nomineeName,
        nomineeB2cId: row.nomineeB2cId,
      }) === newKey
    ) {
      return NextResponse.json(
        { ok: false, message: "This member is already nominated for this position." },
        { status: 409 },
      );
    }
  }

  try {
    const row = await prisma.nomination.create({
      data: {
        nomineeName,
        position,
        nominator: { connect: { b2cId: nominatorId } },
        nominee: { connect: { b2cId: nomineeB2cId } },
        status,
        ...(status === "accepted" ? { respondedAt: new Date() } : {}),
      },
      select: nominationSelect,
    });
    return NextResponse.json({ ok: true, data: row }, { status: 201 });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "P2003") {
      return NextResponse.json({ ok: false, message: "Invalid nominator or nominee B2C ID." }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: "Failed to create nomination." }, { status: 500 });
  }
}

/** Update nomination fields (admin / election committee). */
export async function PATCH(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`admin_nominations_patch:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: ActorBody & {
    nominationId?: string;
    position?: string;
    nomineeName?: string;
    nomineeB2cId?: string | null;
    status?: string;
    respondedAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const auth = await authorizeActor(body);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const frozen = await assertElectionNotFinalized();
  if (!frozen.ok) return NextResponse.json({ ok: false, message: frozen.message }, { status: frozen.status });

  const nominationId = typeof body.nominationId === "string" ? body.nominationId.trim() : "";
  if (!nominationId) {
    return NextResponse.json({ ok: false, message: "nominationId is required." }, { status: 400 });
  }

  const existing = await prisma.nomination.findUnique({
    where: { id: nominationId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Nomination not found." }, { status: 404 });
  }

  const patch: {
    position?: string;
    nomineeName?: string;
    nomineeB2cId?: string | null;
    status?: string;
    respondedAt?: Date | null;
  } = {};

  if (body.position !== undefined) {
    const p = String(body.position).trim();
    if (!isCommitteePosition(p)) {
      return NextResponse.json({ ok: false, message: "Invalid committee position." }, { status: 400 });
    }
    patch.position = p;
  }
  if (body.nomineeName !== undefined) {
    const nn = String(body.nomineeName).trim();
    if (!nn) {
      return NextResponse.json({ ok: false, message: "nomineeName cannot be empty." }, { status: 400 });
    }
    patch.nomineeName = nn;
  }
  if (body.nomineeB2cId !== undefined) {
    const nb = body.nomineeB2cId === null ? null : String(body.nomineeB2cId).trim();
    patch.nomineeB2cId = nb === "" ? null : nb;
  }
  if (body.status !== undefined) {
    const s = String(body.status).trim();
    if (s !== "pending" && s !== "accepted") {
      return NextResponse.json({ ok: false, message: "status must be pending or accepted." }, { status: 400 });
    }
    patch.status = s;
    if (s === "accepted" && body.respondedAt === undefined) {
      patch.respondedAt = new Date();
    }
    if (s === "pending") {
      patch.respondedAt = null;
    }
  }
  if (body.respondedAt !== undefined) {
    if (body.respondedAt === null || body.respondedAt === "") {
      patch.respondedAt = null;
    } else {
      const d = new Date(body.respondedAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ ok: false, message: "Invalid respondedAt." }, { status: 400 });
      }
      patch.respondedAt = d;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: "No fields to update." }, { status: 400 });
  }

  try {
    if (patch.nomineeB2cId) {
      const u = await prisma.user.findUnique({
        where: { b2cId: patch.nomineeB2cId },
        select: { b2cId: true },
      });
      if (!u) {
        return NextResponse.json({ ok: false, message: "Nominee B2C ID not found." }, { status: 400 });
      }
    }

    const updated = await prisma.nomination.update({
      where: { id: nominationId },
      data: patch,
      select: nominationSelect,
    });
    return NextResponse.json({ ok: true, data: updated });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "P2003") {
      return NextResponse.json({ ok: false, message: "Invalid nominee B2C ID." }, { status: 400 });
    }
    return NextResponse.json({ ok: false, message: "Failed to update nomination." }, { status: 500 });
  }
}

/** Delete nomination (admin / election committee). */
export async function DELETE(request: Request) {
  const ip = getClientIp(request);
  const rl = takeRateLimit(`admin_nominations:${ip}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, message: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let body: ActorBody & { nominationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const auth = await authorizeActor(body);
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const frozen = await assertElectionNotFinalized();
  if (!frozen.ok) return NextResponse.json({ ok: false, message: frozen.message }, { status: frozen.status });

  let nominationId = typeof body.nominationId === "string" ? body.nominationId.trim() : "";
  if (!nominationId) {
    const url = new URL(request.url);
    nominationId = url.searchParams.get("nominationId")?.trim() ?? "";
  }
  if (!nominationId) {
    return NextResponse.json({ ok: false, message: "nominationId is required." }, { status: 400 });
  }

  try {
    await prisma.nomination.delete({ where: { id: nominationId } });
    return NextResponse.json({ ok: true, data: { id: nominationId } });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "P2025") {
      return NextResponse.json({ ok: false, message: "Nomination not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: false, message: "Failed to delete nomination." }, { status: 500 });
  }
}
