"use client";

import { useCallback, useEffect, useState } from "react";

import { COMMITTEES, type CommitteeName } from "@/lib/election";

type NominationRow = {
  id: string;
  nomineeName: string;
  position: string;
  nominatorId: string;
  nomineeB2cId: string | null;
  status: string;
  respondedAt: string | null;
  createdAt: string;
  nominator?: { b2cId: string; firstName: string; lastName: string };
};

type NominationsAdminPanelProps = {
  actorB2cId: string;
  password: string;
  electionEnded: boolean;
  onNominationsChanged: () => void;
};

export function NominationsAdminPanel({
  actorB2cId,
  password,
  electionEnded,
  onNominationsChanged,
}: NominationsAdminPanelProps) {
  const [rows, setRows] = useState<NominationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{
    position: string;
    nomineeName: string;
    nomineeB2cId: string;
    status: string;
  }>({ position: "", nomineeName: "", nomineeB2cId: "", status: "pending" });

  const [create, setCreate] = useState<{
    nominatorId: string;
    nomineeB2cId: string;
    position: CommitteeName;
    nomineeName: string;
    status: "pending" | "accepted";
  }>({
    nominatorId: "",
    nomineeB2cId: "",
    position: (COMMITTEES[0] ?? "Board of Director") as CommitteeName,
    nomineeName: "",
    status: "pending",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/nominations");
      const json = (await res.json()) as { ok?: boolean; data?: NominationRow[] };
      if (!res.ok || !json.ok || !Array.isArray(json.data)) {
        setError("Could not load nominations.");
        setRows([]);
        return;
      }
      setRows(json.data);
    } catch {
      setError("Could not load nominations.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runPatch = async (nominationId: string, patch: Record<string, unknown>) => {
    setMsg(null);
    const res = await fetch("/api/admin/nominations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorB2cId,
        password,
        nominationId,
        ...patch,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      setMsg(typeof json.message === "string" ? json.message : "Update failed.");
      return;
    }
    setMsg("Nomination updated.");
    setEditingId(null);
    await load();
    onNominationsChanged();
  };

  const runDelete = async (nominationId: string) => {
    if (!window.confirm("Delete this nomination? This cannot be undone.")) return;
    setMsg(null);
    const res = await fetch("/api/admin/nominations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorB2cId, password, nominationId }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      setMsg(typeof json.message === "string" ? json.message : "Delete failed.");
      return;
    }
    setMsg("Nomination deleted.");
    await load();
    onNominationsChanged();
  };

  const runCreate = async () => {
    setMsg(null);
    const res = await fetch("/api/admin/nominations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorB2cId,
        password,
        nominatorId: create.nominatorId.trim(),
        nomineeB2cId: create.nomineeB2cId.trim(),
        position: create.position,
        nomineeName: create.nomineeName.trim(),
        status: create.status,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!res.ok || !json.ok) {
      setMsg(typeof json.message === "string" ? json.message : "Create failed.");
      return;
    }
    setMsg("Nomination created.");
    setCreate((c) => ({
      ...c,
      nominatorId: "",
      nomineeB2cId: "",
      nomineeName: "",
    }));
    await load();
    onNominationsChanged();
  };

  const startEdit = (row: NominationRow) => {
    setEditingId(row.id);
    setEdit({
      position: row.position,
      nomineeName: row.nomineeName,
      nomineeB2cId: row.nomineeB2cId ?? "",
      status: row.status,
    });
  };

  if (loading) {
    return (
      <p className="text-center text-xs text-slate-500">Loading nominations…</p>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">Manage nominations</h3>
      <p className="text-[10px] font-medium text-slate-500">
        Portal administrators and election committee can create, edit, or remove nominations.
        {electionEnded && (
          <span className="block font-bold text-amber-700">Election is ended — changes are disabled.</span>
        )}
      </p>
      {error && <p className="text-xs font-bold text-red-600">{error}</p>}
      {msg && <p className="text-xs font-bold text-emerald-700">{msg}</p>}

      <div className="max-h-72 overflow-auto rounded-2xl border border-slate-100">
        <table className="w-full min-w-[640px] text-left text-[10px]">
          <thead className="sticky top-0 bg-slate-50 font-black uppercase text-slate-500">
            <tr>
              <th className="p-2">Nominee</th>
              <th className="p-2">Position</th>
              <th className="p-2">Nominator</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                {editingId === row.id ? (
                  <>
                    <td className="p-2 align-top">
                      <input
                        value={edit.nomineeName}
                        onChange={(e) => setEdit((s) => ({ ...s, nomineeName: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 font-bold"
                      />
                      <input
                        value={edit.nomineeB2cId}
                        onChange={(e) => setEdit((s) => ({ ...s, nomineeB2cId: e.target.value }))}
                        placeholder="B2C ID"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 font-mono text-[9px]"
                      />
                    </td>
                    <td className="p-2 align-top">
                      <select
                        value={edit.position}
                        onChange={(e) => setEdit((s) => ({ ...s, position: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 font-bold"
                      >
                        {COMMITTEES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 text-slate-600">
                      {row.nominator
                        ? `${row.nominator.firstName} ${row.nominator.lastName}`
                        : row.nominatorId}
                    </td>
                    <td className="p-2 align-top">
                      <select
                        value={edit.status}
                        onChange={(e) => setEdit((s) => ({ ...s, status: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1 font-bold"
                      >
                        <option value="pending">pending</option>
                        <option value="accepted">accepted</option>
                      </select>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={electionEnded}
                        onClick={() =>
                          void runPatch(row.id, {
                            position: edit.position,
                            nomineeName: edit.nomineeName,
                            nomineeB2cId: edit.nomineeB2cId.trim() || null,
                            status: edit.status,
                          })
                        }
                        className="mr-1 rounded-lg bg-blue-700 px-2 py-1 text-[9px] font-black uppercase text-white disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-[9px] font-bold"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-2 font-bold text-slate-800">{row.nomineeName}</td>
                    <td className="p-2">{row.position}</td>
                    <td className="p-2 text-slate-600">
                      {row.nominator
                        ? `${row.nominator.firstName} ${row.nominator.lastName}`
                        : row.nominatorId}
                    </td>
                    <td className="p-2 font-bold uppercase text-slate-700">{row.status}</td>
                    <td className="p-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={electionEnded}
                        onClick={() => startEdit(row)}
                        className="mr-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[9px] font-black uppercase text-blue-800 disabled:opacity-40"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={electionEnded}
                        onClick={() => void runDelete(row.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-800 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-4 text-center text-[10px] italic text-slate-400">No nominations yet.</p>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-dashed border-slate-200 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Add nomination</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            placeholder="Nominator B2C ID"
            value={create.nominatorId}
            onChange={(e) => setCreate((c) => ({ ...c, nominatorId: e.target.value }))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
          />
          <input
            placeholder="Nominee B2C ID"
            value={create.nomineeB2cId}
            onChange={(e) => setCreate((c) => ({ ...c, nomineeB2cId: e.target.value }))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
          />
          <input
            placeholder="Nominee display name"
            value={create.nomineeName}
            onChange={(e) => setCreate((c) => ({ ...c, nomineeName: e.target.value }))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold sm:col-span-2"
          />
          <select
            value={create.position}
            onChange={(e) =>
              setCreate((c) => ({ ...c, position: e.target.value as CommitteeName }))
            }
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
          >
            {COMMITTEES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={create.status}
            onChange={(e) =>
              setCreate((c) => ({
                ...c,
                status: e.target.value as "pending" | "accepted",
              }))
            }
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold"
          >
            <option value="pending">pending</option>
            <option value="accepted">accepted</option>
          </select>
        </div>
        <button
          type="button"
          disabled={electionEnded}
          onClick={() => void runCreate()}
          className="w-full rounded-2xl bg-slate-900 py-3 text-xs font-black uppercase text-white disabled:opacity-40"
        >
          Create nomination
        </button>
      </div>
    </div>
  );
}
