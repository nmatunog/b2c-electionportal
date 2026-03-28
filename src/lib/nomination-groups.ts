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
