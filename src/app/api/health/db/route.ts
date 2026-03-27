import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/** GET /api/health/db — verifies DATABASE_URL and that the DB accepts connections. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "connected" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, database: "error", message },
      { status: 503 },
    );
  }
}
