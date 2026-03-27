import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function MembersRegistryPage() {
  const session = (await cookies()).get("b2c_registry_session")?.value;
  if (session !== "1") {
    redirect("/");
  }

  const members = await prisma.user.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      lastName: true,
      firstName: true,
      b2cId: true,
    },
  });

  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-40 mx-auto flex h-16 max-w-xl items-center justify-between border-b border-slate-100 bg-white/80 px-4 backdrop-blur-md sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-xs font-bold text-white shadow-lg">
            B
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-tighter text-blue-950">
            B2C <span className="font-bold text-blue-600">Portal</span>
          </span>
        </Link>
        <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-tight text-slate-600 sm:px-3 sm:text-[10px]">
          Members Registry
        </span>
      </header>

      <main className="mx-auto max-w-xl px-6 pb-24 pt-24">
        <div className="mb-8 flex flex-col gap-1">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Members Registry</h1>
          <p className="text-sm font-medium text-slate-500">
            Official roster — name and B2C ID ({members.length} total)
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Last name</th>
                  <th className="px-4 py-3">First name</th>
                  <th className="px-4 py-3">B2C ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-500">
                      No members yet. Import the roster or add users via{" "}
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">POST /api/users</code>.
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">{m.lastName}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{m.firstName}</td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-800">{m.b2cId}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
