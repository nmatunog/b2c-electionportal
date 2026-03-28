/**
 * Group nomination rows so the same person for the same position appears once.
 * Identity: **committee position + normalized display name** (same for BOD, Audit, Election Committee).
 * Rows with the same normalized name merge even if one row has nomineeB2cId and another does not,
 * so duplicate nominations and split vote tallies combine.
 */

export type NominationLike = {
  position: string;
  nomineeName: string;
  nomineeB2cId: string | null;
  createdAt: string;
};

/** Collapses spacing, commas, and case so "DOE, Jane" and "jane  doe" match. */
export function normalizeDisplayName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/[,\s]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePosition(position: string): string {
  return position.trim().replace(/\s+/g, " ");
}

export function nominationCandidateKey(row: {
  position: string;
  nomineeName: string;
  nomineeB2cId: string | null;
}): string {
  const pos = normalizePosition(row.position);
  const nameKey = normalizeDisplayName(row.nomineeName);
  return `${pos}\0name:${nameKey}`;
}

/** True if this member already has a nomination row for this committee (same normalized name + position). */
export function isRegistryMemberAlreadyNominatedForPosition(
  member: { firstName: string; lastName: string; b2cId?: string },
  position: string,
  nominations: { position: string; name: string; nomineeB2cId?: string | null }[],
): boolean {
  const nomineeName = `${member.firstName} ${member.lastName}`.trim();
  const key = nominationCandidateKey({
    position,
    nomineeName,
    nomineeB2cId: member.b2cId ?? null,
  });
  return nominations.some((n) => {
    if (n.position !== position) return false;
    return (
      nominationCandidateKey({
        position: n.position,
        nomineeName: n.name,
        nomineeB2cId: n.nomineeB2cId ?? null,
      }) === key
    );
  });
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
