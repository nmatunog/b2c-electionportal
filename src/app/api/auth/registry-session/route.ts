import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { userHasPortalAdminGrant } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "b2c_registry_session";

/**
 * Opens a short-lived server session that allows viewing /members (admin registry table).
 * Nomination search uses /api/users separately and does not require this cookie.
 */
export async function POST(request: Request) {
  let body: { b2cId?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON." }, { status: 400 });
  }

  const b2cId = typeof body.b2cId === "string" ? body.b2cId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!b2cId) {
    return NextResponse.json({ ok: false, message: "Missing b2cId." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { b2cId },
    select: { id: true, password: true },
  });

  if (!user || !(await userHasPortalAdminGrant(user.id))) {
    return NextResponse.json({ ok: false, message: "Forbidden." }, { status: 403 });
  }

  if (user.password) {
    if (password !== user.password) {
      return NextResponse.json({ ok: false, message: "Invalid password." }, { status: 401 });
    }
  }

  const store = await cookies();
  store.set(COOKIE_NAME, "1", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
