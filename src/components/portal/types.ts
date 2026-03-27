export type RegistryMember = {
  lastName: string;
  firstName: string;
  city: string;
  timestamp: string;
  role: string;
  tinNo: string;
  dob: string;
  b2cId?: string;
};

/** Matches GET/POST /api/nominations — `id` is the server-side cuid */
export type PortalNomination = {
  id: string;
  nomineeId: string;
  name: string;
  position: string;
  nomineeB2cId?: string;
  status: "pending" | "accepted";
};
