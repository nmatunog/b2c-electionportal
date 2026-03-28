"use client";

import { useState } from "react";

type PositionRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  grantsPortalAdmin: boolean;
  maxAssignees: number | null;
};

type SuperUserPanelProps = {
  actorB2cId: string;
  password: string;
  positions: PositionRow[];
};

export function SuperUserPanel({ actorB2cId, password, positions }: SuperUserPanelProps) {
  const [memberB2cId, setMemberB2cId] = useState("");
  const [slug, setSlug] = useState(positions[0]?.slug ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  if (positions.length === 0) return null;

  const run = async (action: "assign" | "unassign") => {
    setMsg(null);
    const res = await fetch("/api/admin/officer-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorB2cId,
        password,
        userB2cId: memberB2cId.trim(),
        positionSlug: slug,
        action,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(typeof j.message === "string" ? j.message : "Request failed.");
      return;
    }
    setMsg(action === "assign" ? "Assignment saved." : "Assignment removed.");
  };

  return (
    <div className="mb-8 space-y-4 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-5 shadow-sm sm:rounded-3xl sm:p-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-amber-950">Officer assignments</h3>
      <p className="text-xs font-medium leading-relaxed text-amber-900/90 sm:text-[11px]">
        Assign members to cooperative positions (portal admin access follows each position&apos;s rules). Use the member&apos;s B2C ID.
      </p>
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Member B2C ID"
          value={memberB2cId}
          onChange={(e) => setMemberB2cId(e.target.value)}
          className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3.5 text-sm font-semibold shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:rounded-2xl"
        />
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3.5 text-sm font-semibold shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:rounded-2xl"
        >
          {positions.map((p) => (
            <option key={p.id} value={p.slug}>
              {p.title} ({p.category})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        <button
          type="button"
          onClick={() => void run("assign")}
          className="min-h-11 rounded-xl bg-amber-950 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-amber-900 sm:rounded-2xl"
        >
          Assign
        </button>
        <button
          type="button"
          onClick={() => void run("unassign")}
          className="min-h-11 rounded-xl border border-amber-300 bg-white py-3 text-xs font-bold uppercase tracking-wide text-amber-950 shadow-sm transition hover:bg-amber-50 sm:rounded-2xl"
        >
          Unassign
        </button>
      </div>
      {msg && <p className="text-center text-[10px] font-bold text-amber-900">{msg}</p>}
    </div>
  );
}
