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
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-slate-200/80 bg-white/95 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-2 px-4 sm:h-16 sm:max-w-2xl sm:px-6 lg:max-w-3xl">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-xl py-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1e3a5f] text-[10px] font-bold text-white shadow-md">
              B2C
            </div>
            <span className="truncate text-xs font-extrabold tracking-tight text-slate-900 sm:text-sm">
              Election <span className="text-blue-700">Portal</span>
            </span>
          </Link>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 sm:px-3 sm:text-[10px]">
            Registry
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-[calc(4rem+env(safe-area-inset-top))] sm:max-w-2xl sm:px-6 sm:pt-[calc(4.5rem+env(safe-area-inset-top))] lg:max-w-3xl">
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
