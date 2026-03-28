/**
 * Group nomination rows so the same person for the same position appears once.
 * Identity: nominee B2C ID when set; otherwise normalized display name.
 */

export type NominationLike = {
  position: string;
  nomineeName: string;
  nomineeB2cId: string | null;
  createdAt: string;
};

function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function nominationCandidateKey(row: {
  position: string;
  nomineeName: string;
  nomineeB2cId: string | null;
}): string {
  const pos = row.position.trim();
  const b2c = row.nomineeB2cId?.trim();
  if (b2c) return `${pos}\0${b2c.toUpperCase()}`;
  return `${pos}\0name:${normalizeDisplayName(row.nomineeName)}`;
}

export function groupNominationsByCandidate<T extends NominationLike>(rows: T[]): { key: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = nominationCandidateKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, rows: list }))
    .sort((a, b) => {
      const pa = a.rows[0]?.position ?? "";
      const pb = b.rows[0]?.position ?? "";
      const c = pa.localeCompare(pb);
      if (c !== 0) return c;
      return (a.rows[0]?.nomineeName ?? "").localeCompare(b.rows[0]?.nomineeName ?? "", undefined, {
        sensitivity: "base",
      });
    });
}

/** Same person + position → one row; canonical id is lexicographically smallest nomination id. */
export function dedupeByCandidateIdentity<T extends { id: string; position: string; name: string; nomineeB2cId?: string | null }>(
  rows: T[],
): T[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = nominationCandidateKey({
      position: row.position,
      nomineeName: row.name,
      nomineeB2cId: row.nomineeB2cId ?? null,
    });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return [...map.values()].map((group) => [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!);
}

/**
 * Merge accepted nominations for one committee: sum vote counts for rows that share the same candidate identity.
 */
export function mergeNominationVotesForCommittee<
  T extends { id: string; position: string; nomineeName: string; nomineeB2cId: string | null },
>(
  nominationsForCommittee: T[],
  getVotes: (nominationId: string) => number,
): { nominationId: string; nomineeName: string; votes: number; mergedNominationIds: string[] }[] {
  const map = new Map<string, T[]>();
  for (const n of nominationsForCommittee) {
    const key = nominationCandidateKey(n);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  const out: { nominationId: string; nomineeName: string; votes: number; mergedNominationIds: string[] }[] = [];
  for (const group of map.values()) {
    const mergedNominationIds = group.map((g) => g.id).sort((a, b) => a.localeCompare(b));
    let votes = 0;
    for (const id of mergedNominationIds) votes += getVotes(id);
    const sortedName = [...group].sort((a, b) =>
      a.nomineeName.localeCompare(b.nomineeName, undefined, { sensitivity: "base" }),
    );
    const nomineeName = sortedName[0]!.nomineeName.trim();
    const nominationId = mergedNominationIds[0]!;
    out.push({ nominationId, nomineeName, votes, mergedNominationIds });
  }
  out.sort((a, b) => b.votes - a.votes);
  return out;
}
