export const COMMITTEE_SEATS = {
  "Board of Director": 3,
  "Election Committee": 2,
  "Audit Committee": 2,
} as const;

export type CommitteeName = keyof typeof COMMITTEE_SEATS;

export const COMMITTEES = Object.keys(COMMITTEE_SEATS) as CommitteeName[];

